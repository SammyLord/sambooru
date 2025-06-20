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
        const query = req.query.tags || '';
        const page = parseInt(req.query.page) || 1;
        const limit = 50;

        const allDbPosts = (await posts.all()).map(p => ({ id: p.id, ...p.value }));
        const allDbTags = await tagsDb.all();

        if (!query.trim()) {
            // If no search query, show latest posts (respecting blacklist)
            let blacklistedTagIds = [];
            if (req.session.userId) {
                const currentUser = await users.get(req.session.userId);
                if (currentUser && currentUser.blacklist) {
                    const blacklistNames = currentUser.blacklist;
                    blacklistedTagIds = allDbTags
                        .filter(t => blacklistNames.includes(t.value.name))
                        .map(t => t.id);
                }
            }

            const filteredPosts = allDbPosts.filter(p => {
                const postTagIds = p.tags || [];
                return !postTagIds.some(tid => blacklistedTagIds.includes(tid));
            }).sort((a, b) => b.id - a.id);

            const paginatedPosts = filteredPosts.slice((page - 1) * limit, page * limit);
            const totalPages = Math.ceil(filteredPosts.length / limit);

            for (const post of paginatedPosts) {
                post.tags = post.tags.map(tagId => {
                    const tag = allDbTags.find(t => t.id === tagId);
                    return tag ? tag.value : null;
                }).filter(Boolean);
            }

            return res.render('search_results', { 
                posts: paginatedPosts, 
                query: '',
                currentPage: page,
                totalPages: totalPages
            });
        }

        const searchTags = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const includedTags = searchTags.filter(t => !t.startsWith('-'));
        const excludedTags = searchTags.filter(t => t.startsWith('-')).map(t => t.substring(1));
        
        console.log("Searching for tags:", { includedTags, excludedTags });

        const includedTagIds = allDbTags
            .filter(t => includedTags.includes(t.value.name.toLowerCase()))
            .map(t => t.id);

        // If a non-negated tag is searched for but doesn't exist, no results can be found.
        if (includedTags.length > 0 && includedTagIds.length !== includedTags.length) {
             return res.render('search_results', {
                posts: [],
                query,
                currentPage: 1,
                totalPages: 1
            });
        }

        const excludedTagIds = allDbTags
            .filter(t => excludedTags.includes(t.value.name.toLowerCase()))
            .map(t => t.id);

        let blacklistedTagIds = [];
        if (req.session.userId) {
            const currentUser = await users.get(req.session.userId);
            if (currentUser && currentUser.blacklist) {
                const blacklistNames = currentUser.blacklist;
                blacklistedTagIds = allDbTags
                    .filter(t => blacklistNames.includes(t.value.name))
                    .map(t => t.id);
            }
        }
        
        const matchedPosts = allDbPosts.filter(p => {
            const postTagIds = p.tags || [];

            // Check against blacklist
            if (postTagIds.some(tid => blacklistedTagIds.includes(tid))) {
                return false;
            }

            const hasAllIncluded = includedTags.length === 0 || includedTagIds.every(id => postTagIds.includes(id));
            const hasNoExcluded = !postTagIds.some(id => excludedTagIds.includes(id));

            return hasAllIncluded && hasNoExcluded;
        }).sort((a, b) => b.id - a.id);

        const totalPages = Math.ceil(matchedPosts.length / limit);
        const paginatedPosts = matchedPosts.slice((page - 1) * limit, page * limit);

        for (const post of paginatedPosts) {
            post.tags = post.tags.map(tagId => {
                const tag = allDbTags.find(t => t.id === tagId);
                return tag ? tag.value : null;
            }).filter(Boolean);
        }

        res.render('search_results', { 
            posts: paginatedPosts, 
            query,
            currentPage: page,
            totalPages
        });

    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
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
    const lowerCaseName = name.toLowerCase();
    const allTags = await tagsDb.all();
    let tag = allTags.find(t => t.value.name.toLowerCase() === lowerCaseName);

    if (tag) {
        return tag.id;
    }

    const tagId = await db.add('tag_counter', 1);
    await tagsDb.set(tagId.toString(), { name: lowerCaseName, category });
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
            console.log("Attempting auto-tagging...");
            const prompt = 'List keywords for this image, separated by spaces. Example: "1girl cat_ears blue_hair smile"';
            
            if (file.mimetype.startsWith('image/')) {
                const imageBase64 = (await fs.readFile(file.path)).toString('base64');
                const response = await ollama.generate({ model: 'moondream', prompt: prompt, images: [imageBase64], stream: false });
                autoTags = response.response.trim().split(/\s+/).filter(Boolean);
            } else if (file.mimetype.startsWith('video/')) {
                const framePath = path.join(__dirname, '..', '..', 'uploads', `${hash}_frame.png`);
                await new Promise((resolve, reject) => {
                    ffmpeg(file.path)
                        .screenshots({ count: 1, filename: `${hash}_frame.png`, folder: 'uploads/' })
                        .on('end', resolve).on('error', reject);
                });
                const frameBase64 = (await fs.readFile(framePath)).toString('base64');
                const response = await ollama.generate({ model: 'moondream', prompt: prompt, images: [frameBase64], stream: false });
                autoTags = response.response.trim().split(/\s+/).filter(Boolean);
                await fs.unlink(framePath);
            }
        } catch (e) {
            console.error("Ollama auto-tagging failed:", e.message);
        }
        
        console.log("User tags:", tags);
        console.log("Auto tags:", autoTags);

        const userTags = tags.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const cleanAutoTags = autoTags.map(tag => tag.toLowerCase());
        const combinedTags = [...new Set([...userTags, ...cleanAutoTags])];
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
            const tempPath = req.file.path;
            const outputFilename = `${hash}.mov`;
            const processedPath = path.join(uploadsDir, outputFilename);
            const thumbPath = path.join(thumbnailsDir, `${hash}.png`);

            console.log(`Transcoding video ${tempPath} to ${processedPath}`);

            try {
                // Transcode the video to Cinepak .mov
                await new Promise((resolve, reject) => {
                    ffmpeg(tempPath)
                        .outputOptions(['-c:v', 'cinepak', '-c:a', 'adpcm_ima_qt', '-q:v', '5'])
                        .toFormat('mov')
                        .on('end', resolve)
                        .on('error', (err) => {
                            console.error('Error during transcoding:', err.message);
                            reject(err);
                        })
                        .save(processedPath);
                });
                console.log('Video transcoding finished.');

                // Create a thumbnail from the transcoded video
                await new Promise((resolve, reject) => {
                    ffmpeg(processedPath)
                        .screenshots({
                            count: 1,
                            timemarks: ['1'], // seek to 1 second
                            filename: `${hash}.png`,
                            folder: thumbnailsDir,
                            size: '150x150'
                        })
                        .on('end', resolve)
                        .on('error', (err) => {
                            console.error('Error creating video thumbnail:', err.message);
                            reject(err);
                        });
                });
                 console.log('Video thumbnail created.');

                fileToSave = outputFilename;
                postType = 'video';
                
                const dimensions = await getVideoDimensions(processedPath);
                width = dimensions.width;
                height = dimensions.height;
                
                const thumbDimensions = await getImageDimensions(thumbPath);
                thumbWidth = thumbDimensions.width;
                thumbHeight = thumbDimensions.height;

            } catch (error) {
                console.error("Video processing failed:", error);
                // Attempt to clean up the failed processed file
                await fs.unlink(processedPath).catch(e => console.error("Failed to delete processed file on error:", e));
                return res.status(500).send('Server error during video processing.');
            }
        }
        
        const postId = await db.add('post_counter', 1);
        
        newPost.tags = [];
        for (const tagName of combinedTags) {
            const tagId = await getOrCreateTag(tagName, category || 'general');
            newPost.tags.push(tagId);
        }

        await posts.set(postId.toString(), newPost);
        
        // On success, clean up the original temporary file
        await fs.unlink(req.file.path).catch(e => console.error("Failed to delete original upload:", e));

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
        const tagNames = tags.trim().toLowerCase().split(/\s+/).filter(Boolean);
        
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