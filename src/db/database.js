const { QuickDB } = require('quick.db');
const path = require('path');

const db = new QuickDB({ filePath: path.join(__dirname, 'sambooru.sqlite') });

// We will use tables to simulate collections
const users = db.table('users');
const posts = db.table('posts');
const tags = db.table('tags');
const comments = db.table('comments');
const favorites = db.table('favorites');

// We also need to manage counters for auto-incrementing IDs
async function initializeCounters() {
    if (!(await db.has('user_counter'))) {
        await db.set('user_counter', 0);
    }
    if (!(await db.has('post_counter'))) {
        await db.set('post_counter', 0);
    }
    if (!(await db.has('tag_counter'))) {
        await db.set('tag_counter', 0);
    }
    if (!(await db.has('comment_counter'))) {
        await db.set('comment_counter', 0);
    }
    if (!(await db.has('favorite_counter'))) {
        await db.set('favorite_counter', 0);
    }
}

initializeCounters().then(() => {
    console.log('QuickDB database initialized and counters are set.');
});

module.exports = {
    db,
    users,
    posts,
    tags,
    comments,
    favorites
}; 