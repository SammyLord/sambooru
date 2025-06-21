const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { db, users, posts, tags } = require('../db/database');

// GET registration page
router.get('/register', (req, res) => {
    res.render('register');
});

// GET login page
router.get('/login', (req, res) => {
    res.render('login');
});

// GET user settings page
router.get('/settings', async (req, res) => {
    if (!req.session.userId) {
        return res.redirect('/users/login');
    }
    const user = await users.get(req.session.userId);
    const blacklist = user.blacklist || [];
    res.render('settings', { blacklist: blacklist.join(' ') });
});

// GET user profile page
router.get('/:username', async (req, res) => {
    try {
        const username = req.params.username;
        const allUsers = await users.all();
        const userEntry = allUsers.find(u => u.value.username === username);

        if (!userEntry) {
            return res.status(404).send('User not found.');
        }

        const allPosts = await posts.all();
        let userPosts = allPosts.filter(p => p.value.uploader_id === userEntry.id);
        
        // Apply blacklist for the logged-in user
        if (req.session.userId) {
            const currentUser = await users.get(req.session.userId);
            if (currentUser && currentUser.blacklist) {
                const allTagsDb = await tags.all();
                const blacklistedTagIds = allTagsDb
                    .filter(t => currentUser.blacklist.includes(t.value.name))
                    .map(t => t.id);
                
                if (blacklistedTagIds.length > 0) {
                    userPosts = userPosts.filter(p => 
                        !p.value.tags.some(tid => blacklistedTagIds.includes(tid))
                    );
                }
            }
        }

        res.render('profile', { profileUser: userEntry.value, posts: userPosts });

    } catch (error) {
        console.error(error);
        res.status(500).send('Server error retrieving user profile.');
    }
});

// POST register a new user
router.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).send('Username and password are required.');
        }

        const allUsers = await users.all();
        const userExists = allUsers.some(u => u.value.username === username);

        if (userExists) {
            return res.status(400).send('Username already taken.');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = await db.add('user_counter', 1);

        await users.set(userId.toString(), {
            username,
            password_hash: hashedPassword,
            role: 'user'
        });

        res.redirect('/users/login');

    } catch (error) {
        console.error(error);
        res.status(500).send('Server error during registration.');
    }
});

// POST login a user
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).send('Username and password are required.');
        }

        const allUsers = await users.all();
        const userEntry = allUsers.find(u => u.value.username === username);

        if (!userEntry) {
            return res.status(400).send('Invalid credentials.');
        }

        const user = userEntry.value;
        const passwordMatch = await bcrypt.compare(password, user.password_hash);

        if (!passwordMatch) {
            return res.status(400).send('Invalid credentials.');
        }

        req.session.user = {
            id: userEntry.id,
            username: user.username,
            role: user.role
        };
        req.session.userId = userEntry.id; // Keep for compatibility for now
        
        res.redirect('/');

    } catch (error) {
        console.error(error);
        res.status(500).send('Server error during login.');
    }
});

// POST user settings
router.post('/settings', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).send('Not logged in.');
    }
    try {
        const { blacklist } = req.body;
        const user = await users.get(req.session.userId);
        if (user) {
            user.blacklist = blacklist.trim().toLowerCase().split(/\s+/).filter(Boolean);
            await users.set(req.session.userId, user);
        }
        res.redirect('/users/settings');
    } catch (e) {
        res.status(500).send('Error updating settings.');
    }
});

// GET logout
router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if(err) {
            return res.redirect('/');
        }
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

module.exports = router; 