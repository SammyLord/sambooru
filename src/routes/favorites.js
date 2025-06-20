const express = require('express');
const router = express.Router();
const { db, favorites } = require('../db/database');

// Favorite a post
router.post('/:postId/favorite', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).send('You must be logged in to favorite a post.');
    }

    try {
        const postId = req.params.postId;
        const userId = req.session.userId;

        // Check if it's already favorited
        const allFavorites = await favorites.all();
        const existing = allFavorites.find(f => f.value.user_id === userId && f.value.post_id === postId);

        if (!existing) {
            const favId = await db.add('favorite_counter', 1);
            await favorites.set(favId.toString(), {
                user_id: userId,
                post_id: postId
            });
        }
        
        res.redirect(`/posts/${postId}`);

    } catch (error) {
        console.error(error);
        res.status(500).send('Server error favoriting post.');
    }
});

// Unfavorite a post
router.delete('/:postId/favorite', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).send('You must be logged in.');
    }

    try {
        const postId = req.params.postId;
        const userId = req.session.userId;

        const allFavorites = await favorites.all();
        const favToDelete = allFavorites.find(f => f.value.user_id === userId && f.value.post_id === postId);
        
        if (favToDelete) {
            await favorites.delete(favToDelete.id);
        }

        res.redirect(`/posts/${postId}`);

    } catch (error) {
        console.error(error);
        res.status(500).send('Server error unfavoriting post.');
    }
});

module.exports = router; 