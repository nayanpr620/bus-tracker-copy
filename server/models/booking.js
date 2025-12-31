const mongoose = require("mongoose");

const BookingSchema = new mongoose.Schema({
  userId: String,
  busId: String,
  amount: Number,
  paymentStatus: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Booking", BookingSchema);