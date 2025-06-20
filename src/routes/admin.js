const express = require('express');
const router = express.Router();
const { users, posts, tags, comments } = require('../db/database');

// Middleware to check for admin role
function isAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).send('Access denied. You must be an admin to view this page.');
}

router.use(isAdmin);

// Main admin dashboard
router.get('/', (req, res) => {
    res.render('admin/index');
});

// User management
router.get('/users', async (req, res) => {
    const allUsers = await users.all();
    res.render('admin/users', { users: allUsers });
});

router.post('/users/:id/role', async (req, res) => {
    try {
        const userId = req.params.id;
        const { role } = req.body;

        if (!['user', 'moderator', 'admin'].includes(role)) {
            return res.status(400).send('Invalid role specified.');
        }

        const user = await users.get(userId);
        if (user) {
            user.role = role;
            await users.set(userId, user);
        }

        res.redirect('/admin/users');

    } catch (error) {
        console.error(error);
        res.status(500).send('Server error updating user role.');
    }
});

// Tag Management
router.get('/tags', async (req, res) => {
    try {
        const allTags = await tags.all();
        res.render('admin/tags', { tags: allTags });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error getting tags page.');
    }
});

router.post('/tags/:id/edit', async (req, res) => {
    try {
        const tagId = req.params.id;
        const { name, category } = req.body;

        const tag = await tags.get(tagId);
        if (tag) {
            tag.name = name;
            tag.category = category;
            await tags.set(tagId, tag);
        }

        res.redirect('/admin/tags');
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error updating tag.');
    }
});

router.post('/tags/:id/delete', async (req, res) => {
    try {
        const tagIdToDelete = req.params.id;
        
        // First, remove the tag from all posts that have it
        const allPosts = await posts.all();
        for (const postEntry of allPosts) {
            const post = postEntry.value;
            if (post.tags && post.tags.includes(tagIdToDelete)) {
                post.tags = post.tags.filter(t => t !== tagIdToDelete);
                await posts.set(postEntry.id, post);
            }
        }

        // Now, delete the tag itself
        await tags.delete(tagIdToDelete);
        
        res.redirect('/admin/tags');
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error deleting tag.');
    }
});

// Post Management
router.get('/posts', async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = 20; // Posts per page
        const startIndex = (page - 1) * limit;
        
        const allPosts = (await posts.all()).sort((a, b) => b.id - a.id);
        const allUsers = await users.all();
        
        const postsWithUsernames = allPosts.map(post => {
            const user = allUsers.find(u => u.id === post.value.uploader_id);
            return {
                ...post,
                uploaderName: user ? user.value.username : 'Unknown'
            };
        });

        const paginatedPosts = postsWithUsernames.slice(startIndex, startIndex + limit);
        const pageCount = Math.ceil(allPosts.length / limit);

        res.render('admin/posts', {
            posts: paginatedPosts,
            page: page,
            pageCount: pageCount,
            limit: limit
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server error getting posts page.');
    }
});

// More routes for managing posts, tags, etc. will go here

module.exports = router; 