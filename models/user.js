// Load required packages
//var mongoose = require('mongoose');

// Define our user schema
//var UserSchema = new mongoose.Schema({
  //  name: String
//});

// Export the Mongoose model
//module.exports = mongoose.model('User', UserSchema);

// Load required packages
var mongoose = require('mongoose');

// Define our user schema
var UserSchema = new mongoose.Schema({
    name:        { type: String, required: true, trim: true },
    email:       { type: String, required: true, lowercase: true, trim: true, unique: true },
    pendingTasks:{ type: [String], default: [] }, // store task _id strings
    dateCreated: { type: Date, default: Date.now }
}, { versionKey: false });

// Ensure unique emails at the DB level
UserSchema.index({ email: 1 }, { unique: true });

// Export the Mongoose model
module.exports = mongoose.model('User', UserSchema);

