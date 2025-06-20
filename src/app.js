require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
// const csrf = require('csurf'); // We will set this up later

const userRoutes = require('./routes/users');
const postRoutes = require('./routes/posts');
const commentRoutes = require('./routes/comments');
const favoriteRoutes = require('./routes/favorites');
const adminRoutes = require('./routes/admin');

const app = express();
const port = 3000;

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'a_default_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Pass user info to all views
app.use((req, res, next) => {
    res.locals.user = req.session.username ? { username: req.session.username, role: req.session.role } : null;
    res.locals.booruName = process.env.BOORU_NAME || 'Sambooru';
    next();
});

// const csrfProtection = csrf({ cookie: true });
// app.use(csrfProtection);

// app.use((req, res, next) => {
//     res.locals.csrfToken = req.csrfToken();
//     next();
// });

app.use('/users', userRoutes);
app.use('/posts', postRoutes);
app.use('/posts', commentRoutes);
app.use('/posts', favoriteRoutes);
app.use('/admin', adminRoutes);

app.get('/', (req, res) => {
    res.render('index');
});

app.get('/upload', (req, res) => {
    res.render('upload');
});

app.listen(port, () => {
    console.log(`Sambooru listening at http://localhost:${port}`);
});

module.exports = app; 