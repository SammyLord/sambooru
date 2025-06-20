const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const { db, posts, tags: tagsDb, users, comments, favorites } = require('../db/database');
const { Ollama } = require('ollama');
const ffmpeg = require('fluent-ffmpeg');

const ollama = new Ollama({ host: process.env.OLLAMA_HOST || 'http://localhost:11434' });

// Configure multer to accept images and videos
const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'];
const upload = multer({
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Unsupported file type'), false);
        }
    }
});

router.get('/search', async (req, res) => {
    try {
        const query = req.query.tags;
        if (!query) {
            return res.render('search_results', { posts: [], query: '' });
        }

        const includedTags = [];
        const excludedTags = [];

        query.trim().split(/\s+/).filter(Boolean).forEach(tag => {
            if (tag.startsWith('-')) {
                excludedTags.push(tag.substring(1));
            } else {
                includedTags.push(tag);
            }
        });

        if (includedTags.length === 0 && excludedTags.length === 0) {
            return res.render('search_results', { posts: [], query });
        }
        
        const allTags = await tagsDb.all();

        // Handle user blacklist
        let blacklistedTagIds = [];
        if (req.session.userId) {
            const currentUser = await users.get(req.session.userId);
            if (currentUser && currentUser.blacklist) {
                const blacklistNames = currentUser.blacklist;
                blacklistedTagIds = allTags
                    .filter(t => blacklistNames.includes(t.value.name))
                    .map(t => t.id);
            }
        }

        const includedTagIds = [];
        for(const tagName of includedTags) {
            const tag = allTags.find(t => t.value.name === tagName);
            if(tag) {
                includedTagIds.push(tag.id);
            } else {
                // If an included tag doesn't exist, no posts can match
                return res.render('search_results', { posts: [], query });
            }
        }

        const excludedTagIds = [];
        for(const tagName of excludedTags) {
            const tag = allTags.find(t => t.value.name === tagName);
            if(tag) {
                excludedTagIds.push(tag.id);
            }
        }

        const allPosts = await posts.all();
        const matchedPosts = allPosts.filter(p => {
            const postTagIds = p.value.tags;
            // Check against blacklist
            if (blacklistedTagIds.length > 0) {
                if (postTagIds.some(tid => blacklistedTagIds.includes(tid))) {
                    return false; // Post contains a blacklisted tag
                }
            }
            const hasAllIncluded = includedTagIds.every(id => postTagIds.includes(id));
            const hasNoExcluded = excludedTagIds.every(id => !postTagIds.includes(id));
            return hasAllIncluded && hasNoExcluded;
        });

        res.render('search_results', { posts: matchedPosts, query });

    } catch (error) {
        console.error(error);
        res.status(500).send('Server error during search.');
    }
});

router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = 20; // Posts per page
        const startIndex = (page - 1) * limit;

        let allPosts = (await posts.all()).sort((a, b) => b.id - a.id);

        // Handle user blacklist
        if (req.session.userId) {
            const currentUser = await users.get(req.session.userId);
            if (currentUser && currentUser.blacklist) {
                const allTags = await tagsDb.all();
                const blacklistedTagIds = allTags
                    .filter(t => currentUser.blacklist.includes(t.value.name))
                    .map(t => t.id);
                
                if (blacklistedTagIds.length > 0) {
                    allPosts = allPosts.filter(p => 
                        !p.value.tags.some(tid => blacklistedTagIds.includes(tid))
                    );
                }
            }
        }
        
        const paginatedPosts = allPosts.slice(startIndex, startIndex + limit);
        const pageCount = Math.ceil(allPosts.length / limit);

        res.render('all_posts', {
            posts: paginatedPosts,
            page: page,
            pageCount: pageCount
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error getting all posts.');
    }
});

async function getOrCreateTag(name, category) {
    const allTags = await tagsDb.all();
    let tag = allTags.find(t => t.value.name === name);

    if (tag) {
        return tag.id;
    }

    const tagId = await db.add('tag_counter', 1);
    await tagsDb.set(tagId.toString(), { name, category });
    return tagId;
}

router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).send('You must be logged in to upload.');
    }

    try {
        const { tags, category } = req.body;
        const file = req.file;

        if (!file || !tags) {
            if (file) await fs.unlink(file.path);
            return res.status(400).send('File and tags are required.');
        }

        const fileBuffer = await fs.readFile(file.path);
        const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        const allPosts = await posts.all();
        if (allPosts.some(p => p.value.hash === hash)) {
            await fs.unlink(file.path);
            return res.status(409).send('This file has already been uploaded.');
        }

        let autoTags = [];
        try {
            if (file.mimetype.startsWith('image/')) {
                // Auto-tagging for images
                const imageBase64 = (await fs.readFile(file.path)).toString('base64');
                const response = await ollama.generate({ model: 'moondream', prompt: 'Describe this image for a booru. Be descriptive and concise. Only return keywords, separated by spaces. No sentences.', images: [imageBase64], stream: false });
                autoTags = response.response.split(' ').map(t => t.trim().toLowerCase()).filter(Boolean);
            } else if (file.mimetype.startsWith('video/')) {
                // Auto-tag a frame from the video
                const framePath = path.join(__dirname, '..', '..', 'uploads', `${hash}_frame.png`);
                await new Promise((resolve, reject) => {
                    ffmpeg(file.path)
                        .screenshots({ count: 1, filename: `${hash}_frame.png`, folder: 'uploads/' })
                        .on('end', resolve)
                        .on('error', reject);
                });
                const frameBase64 = (await fs.readFile(framePath)).toString('base64');
                const response = await ollama.generate({ model: 'moondream', prompt: 'Describe this video for a booru based on this frame. Be descriptive and concise. Only return keywords, separated by spaces. No sentences.', images: [frameBase64], stream: false });
                autoTags = response.response.split(' ').map(t => t.trim().toLowerCase()).filter(Boolean);
                await fs.unlink(framePath);
            }
        } catch (e) {
            console.error("Ollama auto-tagging failed:", e.message);
        }
        
        console.log("User tags:", tags);
        console.log("Auto tags:", autoTags);

        const userTags = tags.trim().split(/\s+/).filter(Boolean);
        const combinedTags = [...new Set([...userTags, ...autoTags])];
        console.log("Combined tags:", combinedTags);

        let newPost = {
            hash,
            uploader_id: req.session.userId,
            created_at: new Date().toISOString(),
            tags: []
        };
        
        const thumbPath = path.join(__dirname, '..', 'public', 'thumbnails', hash + '.jpg');

        // Process media files
        if (file.mimetype === 'image/gif') {
            newPost.type = 'image';
            newPost.file_ext = '.gif';
            const imagePath = path.join(__dirname, '..', 'public', 'images', hash + newPost.file_ext);
            await fs.rename(file.path, imagePath); // Move the file
            await sharp(imagePath).resize(150, 150, { fit: 'inside' }).toFile(thumbPath);
        } else if (file.mimetype.startsWith('image/')) {
            newPost.type = 'image';
            newPost.file_ext = '.png';
            const imagePath = path.join(__dirname, '..', 'public', 'images', hash + newPost.file_ext);
            await sharp(file.path).png({ quality: 80, compressionLevel: 7 }).toFile(imagePath);
            await sharp(imagePath).resize(150, 150, { fit: 'inside' }).toFile(thumbPath);
        } else if (file.mimetype.startsWith('video/')) {
            newPost.type = 'video';
            newPost.file_ext = '.mpg';
            const videoPath = path.join(__dirname, '..', 'public', 'images', hash + newPost.file_ext);
            
            await new Promise((resolve, reject) => {
                ffmpeg(file.path)
                    .screenshots({ count: 1, timemarks: ['50%'], filename: `${hash}.jpg`, folder: 'src/public/thumbnails/' })
                    .on('end', resolve)
                    .on('error', reject);
            });

            await new Promise((resolve, reject) => {
                ffmpeg(file.path)
                    .toFormat('mpeg').videoCodec('mpeg1video').audioCodec('mp2')
                    .outputOptions('-q:v', '8')
                    .on('end', resolve).on('error', reject)
                    .save(videoPath);
            });
        }
        
        const postId = await db.add('post_counter', 1);
        
        newPost.tags = [];
        for (const tagName of combinedTags) {
            const tagId = await getOrCreateTag(tagName, category || 'general');
            newPost.tags.push(tagId);
        }

        await posts.set(postId.toString(), newPost);
        
        // On success, clean up the original file if it wasn't moved (i.e., not a GIF)
        if (file.mimetype !== 'image/gif') {
            await fs.unlink(file.path);
        }

        res.redirect(`/posts/${postId}`);

    } catch (error) {
        console.error("Upload failed:", error);
        if (req.file) {
            // Only try to unlink the file if it still exists at the temp path
            try {
                await fs.access(req.file.path);
                await fs.unlink(req.file.path);
            } catch (cleanupError) {
                // This error can be ignored if the file is already gone,
                // but we'll log it just in case something else went wrong.
                console.error("Failed to cleanup file during error handling:", cleanupError.message);
            }
        }
        res.status(500).send('Server error during upload: ' + error.message);
    }
});

router.get('/:id', async (req, res) => {
    try {
        const postId = req.params.id;
        const post = await posts.get(postId);

        if (!post) {
            return res.status(404).send('Post not found.');
        }

        // Fetch tag names
        const tagDetails = [];
        if (post.tags && post.tags.length > 0) {
            for (const tagId of post.tags) {
                const tag = await tagsDb.get(tagId.toString());
                if (tag) {
                    tagDetails.push(tag);
                }
            }
        }
        
        // Fetch uploader username
        const uploader = await users.get(post.uploader_id);

        // Fetch comments
        const allComments = await comments.all();
        const postComments = allComments.filter(c => c.value.post_id === postId);

        const allUsers = await users.all();
        const commentsWithUsers = postComments.map(c => {
            const user = allUsers.find(u => u.id === c.value.user_id);
            return {
                ...c.value,
                username: user ? user.value.username : 'unknown'
            };
        });

        // Check if the current user has favorited this post
        let isFavorited = false;
        if (req.session.userId) {
            const allFavorites = await favorites.all();
            isFavorited = allFavorites.some(f => f.value.user_id === req.session.userId && f.value.post_id === postId);
        }

        res.render('post', { post, postId, tagDetails, uploader: uploader || {username: 'unknown'}, comments: commentsWithUsers, isFavorited });

    } catch (error) {
        console.error(error);
        res.status(500).send('Server error retrieving post.');
    }
});

router.delete('/:id', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).send('You must be logged in.');
    }

    try {
        const postId = req.params.id;
        const post = await posts.get(postId);

        if (!post) {
            return res.status(404).send('Post not found.');
        }
        
        const currentUser = await users.get(req.session.userId);

        // Check permissions
        if (post.uploader_id !== req.session.userId && currentUser.role !== 'moderator' && currentUser.role !== 'admin') {
            return res.status(403).send('You do not have permission to delete this post.');
        }

        // Delete files
        const imagePath = path.join(__dirname, '..', 'public', 'images', post.hash + post.file_ext);
        const thumbPath = path.join(__dirname, '..', 'public', 'thumbnails', post.hash + '.jpg');
        await fs.unlink(imagePath).catch(err => console.error(err));
        await fs.unlink(thumbPath).catch(err => console.error(err));

        // Delete post from DB
        await posts.delete(postId);
        
        res.redirect('/');

    } catch (error) {
        console.error(error);
        res.status(500).send('Server error deleting post.');
    }
});

router.get('/:id/edit', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).send('You must be logged in.');
    }

    try {
        const postId = req.params.id;
        const post = await posts.get(postId);

        if (!post) {
            return res.status(404).send('Post not found.');
        }

        const currentUser = await users.get(req.session.userId);

        if (post.uploader_id !== req.session.userId && currentUser.role !== 'moderator' && currentUser.role !== 'admin') {
            return res.status(403).send('You do not have permission to edit this post.');
        }
        
        const allTags = await tagsDb.all();
        const tagNames = post.tags.map(tagId => {
            const tag = allTags.find(t => t.id === tagId);
            return tag ? tag.value.name : '';
        }).join(' ');

        res.render('edit_post', { post, postId, tagNames });

    } catch (error) {
        console.error(error);
        res.status(500).send('Server error getting edit page.');
    }
});

router.post('/:id/edit', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).send('You must be logged in.');
    }

    try {
        const postId = req.params.id;
        const post = await posts.get(postId);

        if (!post) {
            return res.status(404).send('Post not found.');
        }

        const currentUser = await users.get(req.session.userId);
        if (post.uploader_id !== req.session.userId && currentUser.role !== 'moderator' && currentUser.role !== 'admin') {
            return res.status(403).send('You do not have permission to edit this post.');
        }

        const { tags, category } = req.body;
        const tagNames = tags.trim().split(/\s+/).filter(Boolean);
        
        const newTagIds = [];
        for (const tagName of tagNames) {
            const tagId = await getOrCreateTag(tagName, category || 'general');
            newTagIds.push(tagId);
        }

        post.tags = newTagIds;
        await posts.set(postId, post);
        
        res.redirect(`/posts/${postId}`);

    } catch (error) {
        console.error(error);
        res.status(500).send('Server error updating post.');
    }
});

router.get('/:id/delete', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).send('You must be logged in.');
    }

    try {
        const postId = req.params.id;
        const post = await posts.get(postId);

        if (!post) {
            return res.status(404).send('Post not found.');
        }

        const currentUser = await users.get(req.session.userId);
        if (post.uploader_id !== req.session.userId && currentUser.role !== 'moderator' && currentUser.role !== 'admin') {
            return res.status(403).send('You do not have permission to delete this post.');
        }

        res.render('delete_confirm', { postId });

    } catch (error) {
        console.error(error);
        res.status(500).send('Server error getting delete confirmation.');
    }
});

module.exports = router; 