// Get the packages we need
var express = require('express'),
    router = express.Router(),
    mongoose = require('mongoose');

// Read .env file
require('dotenv').config();

// Create our Express application
var app = express();

// Use environment defined port or 3000
var port = process.env.PORT || 3000;


// Allow CORS so that backend and frontend could be put on different servers
var allowCrossDomain = function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
};
app.use(allowCrossDomain);

// Parse URL-encoded and JSON request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Use routes as a module (see index.js)
require('./routes')(app, router);

app.use(function (req, res) {
    res.status(404).json({ message: 'Endpoint not found.', data: null });
});
app.use(function (err, req, res, next) {
    let status = err.status || 500;
    let message = status === 500 ? 'Unable to process the request. Please try again.' : err.message;
    if (err.code === 11000) { status = 400; message = 'Email is already used by another user.'; }
    if (err.name === 'ValidationError' || err.name === 'CastError' || err.name === 'StrictModeError') {
        status = 400; message = 'Invalid field or query value.';
    }
    if (err.type === 'entity.parse.failed') { status = 400; message = 'Request body must contain valid JSON.'; }
    res.status(status).json({ message, data: null });
});

async function start() {
    if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in .env or the service environment.');
    await mongoose.connect(process.env.MONGODB_URI);
    await Promise.all([require('./models/user').init(), require('./models/task').init()]);
    return app.listen(port, () => console.log('Server running on port ' + port));
}
if (require.main === module) {
    start().catch(() => {
        console.error('Startup failed. Check MONGODB_URI and database access.');
        process.exitCode = 1;
    });
}
module.exports = { app, start };
