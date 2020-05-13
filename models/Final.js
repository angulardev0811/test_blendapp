const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Define collection and schema for Product
let Final = new Schema({
  blendName: {
    type: String
  },
  keyname: {
    type: String
  },
  filepath: {
    type: String
  }
},{
    collection: 'Final'
});

module.exports = mongoose.model('Final', Final);