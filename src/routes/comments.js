const express = require('express');
const router = express.Router();
const { db, comments } = require('../db/database');

// POST a new comment
router.post('/:postId/comments', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).send('You must be logged in to comment.');
    }

    try {
        const { content } = req.body;
        const postId = req.params.postId;

        if (!content) {
            return res.status(400).send('Comment content cannot be empty.');
        }

        const commentId = await db.add('comment_counter', 1);
        await comments.set(commentId.toString(), {
            post_id: postId,
            user_id: req.session.userId,
            content,
            created_at: new Date().toISOString()
        });

        res.redirect(`/posts/${postId}`);

    } catch (error) {
        console.error(error);
        res.status(500).send('Server error posting comment.');
    }
});

module.exports = router; 