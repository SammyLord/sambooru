app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/thumbnails', express.static(path.join(__dirname, 'thumbnails')));

app.use((req, res, next) => {
    res.locals.userAgent = req.headers['user-agent'];
    res.locals.user = req.session.user;
    res.locals.booruName = process.env.BOORU_NAME || 'sambooru';
    next();
});

// Routes
app.use('/', require('./src/routes/index'));

// ... existing code ... 