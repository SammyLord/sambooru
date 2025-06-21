const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { db, posts, tags: tagsDb, users, comments, favorites, hashes } = require('../db/database');
const { Ollama } = require('ollama');
const ffmpeg = require('fluent-ffmpeg');

const ollama = new Ollama({ host: process.env.OLLAMA_HOST || 'http://localhost:11434' });
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
const thumbnailsDir = path.join(__dirname, '..', 'public', 'thumbnails');

// Ensure directories exist
fsp.mkdir(uploadsDir, { recursive: true }).catch(console.error);
fsp.mkdir(thumbnailsDir, { recursive: true }).catch(console.error);

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

        const allDbPosts = await posts.all();
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
                const postTagIds = p.value.tags || [];
                return !postTagIds.some(tid => blacklistedTagIds.includes(tid));
            }).sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10));

            const paginatedPosts = filteredPosts.slice((page - 1) * limit, page * limit);
            const totalPages = Math.ceil(filteredPosts.length / limit);

            for (const post of paginatedPosts) {
                if (post.value.tags) {
                    post.value.tags = post.value.tags.map(tagId => {
                        const tag = allDbTags.find(t => t.id === tagId);
                        return tag ? tag.value : null;
                    }).filter(Boolean);
                }
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
            const postTagIds = p.value.tags || [];

            // Check against blacklist
            if (postTagIds.some(tid => blacklistedTagIds.includes(tid))) {
                return false;
            }

            const hasAllIncluded = includedTags.length === 0 || includedTagIds.every(id => postTagIds.includes(id));
            const hasNoExcluded = !postTagIds.some(id => excludedTagIds.includes(id));

            return hasAllIncluded && hasNoExcluded;
        }).sort((a, b) => parseInt(b.id, 10) - parseInt(a.id, 10));

        const totalPages = Math.ceil(matchedPosts.length / limit);
        const paginatedPosts = matchedPosts.slice((page - 1) * limit, page * limit);

        for (const post of paginatedPosts) {
            if (post.value.tags) {
                post.value.tags = post.value.tags.map(tagId => {
                    const tag = allDbTags.find(t => t.id === tagId);
                    return tag ? tag.value : null;
                }).filter(Boolean);
            }
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
    return tagId.toString();
}

async function withTimeout(promise, ms) {
    const timeout = new Promise((_, reject) => {
        const id = setTimeout(() => {
            clearTimeout(id);
            reject(new Error(`Timed out in ${ms}ms.`));
        }, ms);
    });

    return Promise.race([
        promise,
        timeout
    ]);
}

router.post('/upload', upload.single('file'), (req, res) => {
    // Don't use async/await here, we are managing the response stream manually
    
    // Set headers for a streaming response
    res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Transfer-Encoding': 'chunked'
    });

    res.write('<html><body><p>Upload received. Processing, please wait...</p>');

    const heartbeat = setInterval(() => {
        res.write(' '); // Send a space to keep the connection alive
    }, 2000);

    const finish = (message) => {
        clearInterval(heartbeat);
        res.end(`<script>window.location.href = "${message}";</script></body></html>`);
    };

    const fail = (err) => {
        clearInterval(heartbeat);
        console.error("Upload failed:", err);
        res.end(`<p>Error: ${err.message}. Please try again.</p></body></html>`);
        if (req.file) {
            fsp.unlink(req.file.path).catch(e => console.error("Failed to cleanup temp file on fail:", e));
        }
    };

    (async () => {
        if (!req.session.userId) {
            throw new Error('You must be logged in to upload.');
        }

        const { tags, category } = req.body;
        const file = req.file;

        if (!file || !tags) {
            if (file) await fsp.unlink(file.path);
            throw new Error('File and tags are required.');
        }

        const hash = await new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(file.path);
            stream.on('data', (data) => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        });

        if (await hashes.has(hash)) {
            await fsp.unlink(file.path);
            throw new Error('This file has already been uploaded.');
        }

        let autoTags = [];
        try {
            console.log("Attempting auto-tagging...");
            const prompt = 'List keywords for this image, separated by spaces. Example: "1girl cat_ears blue_hair smile"';
            let rawAutoTags = '';
            
            const ollamaGenerate = async (b64) => {
                const response = await ollama.generate({ model: 'moondream', prompt: prompt, images: [b64], stream: false });
                return response.response;
            };

            if (file.mimetype.startsWith('image/')) {
                const imageBase64 = (await fsp.readFile(file.path)).toString('base64');
                rawAutoTags = await withTimeout(ollamaGenerate(imageBase64), 120000); // 2 minute timeout
            } else if (file.mimetype.startsWith('video/')) {
                const framePath = path.join(uploadsDir, `${hash}_frame.png`);
                await new Promise((resolve, reject) => {
                    ffmpeg(file.path)
                        .screenshots({ count: 1, filename: `${hash}_frame.png`, folder: uploadsDir })
                        .on('end', resolve).on('error', reject);
                });
                const frameBase64 = (await fsp.readFile(framePath)).toString('base64');
                rawAutoTags = await withTimeout(ollamaGenerate(frameBase64), 120000); // 2 minute timeout
                await fsp.unlink(framePath);
            }

            if (rawAutoTags) {
                autoTags = rawAutoTags
                    .trim()
                    .toLowerCase()
                    .replace(/["']/g, '')
                    .replace(/[,;()]/g, ' ')
                    .replace(/-/g, '_')
                    .replace(/[^a-z0-9_ ]/g, '')
                    .split(/\s+/)
                    .filter(Boolean);
            }
        } catch (e) {
            console.error("Ollama auto-tagging failed (could be a timeout):", e.message);
        }
        
        const userTags = tags.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const combinedTags = [...new Set([...userTags, ...autoTags])];

        let newPost = {
            hash,
            uploader_id: req.session.userId,
            created_at: new Date().toISOString(),
            tags: []
        };
        
        const thumbPath = path.join(thumbnailsDir, hash + '.jpg');

        if (file.mimetype === 'image/gif') {
            newPost.type = 'image';
            newPost.file_ext = '.gif';
            const imagePath = path.join(__dirname, '..', 'public', 'images', hash + newPost.file_ext);
            await fsp.rename(file.path, imagePath);
            await sharp(imagePath).resize(150, 150, { fit: 'inside' }).toFile(thumbPath);
        } else if (file.mimetype.startsWith('image/')) {
            newPost.type = 'image';
            newPost.file_ext = '.png';
            const imagePath = path.join(__dirname, '..', 'public', 'images', hash + newPost.file_ext);
            await sharp(file.path).png({ quality: 80, compressionLevel: 7 }).toFile(imagePath);
            await sharp(imagePath).resize(150, 150, { fit: 'inside' }).toFile(thumbPath);
        } else if (file.mimetype.startsWith('video/')) {
            newPost.type = 'video';
            newPost.file_ext = '.mp4';

            const tempPath = file.path;
            const processedPath = path.join(__dirname, '..', 'public', 'images', hash + newPost.file_ext);
            
            await new Promise((resolve, reject) => {
                ffmpeg(tempPath)
                    .outputOptions([
                        '-c:v', 'libx264',
                        '-pix_fmt', 'yuv420p',
                        '-c:a', 'aac',
                        '-movflags', '+faststart'
                    ])
                    .toFormat('mp4')
                    .on('end', resolve)
                    .on('error', (err) => {
                        console.error('Error during transcoding:', err.message);
                        reject(err);
                    })
                    .save(processedPath);
            });

            await new Promise((resolve, reject) => {
                ffmpeg(processedPath)
                    .screenshots({
                        count: 1,
                        filename: `${hash}.jpg`,
                        folder: thumbnailsDir
                    })
                    .on('end', resolve)
                    .on('error', reject);
            });
        }
        
        const postId = await db.add('post_counter', 1);
        
        newPost.tags = [];
        for (const tagName of combinedTags) {
            const tagId = await getOrCreateTag(tagName, category || 'general');
            newPost.tags.push(tagId);
        }

        await posts.set(postId.toString(), newPost);
        await hashes.set(hash, postId.toString());
        
        if (req.file) await fsp.unlink(req.file.path).catch(e => console.error("Failed to delete temp upload:", e));

        finish(`/posts/${postId}`);

    })().catch(fail);
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
        await fsp.unlink(imagePath).catch(err => console.error(err));
        await fsp.unlink(thumbPath).catch(err => console.error(err));

        // Delete post from DB
        await posts.delete(postId);
        await hashes.delete(post.hash);
        
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