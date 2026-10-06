const jwt = require("jsonwebtoken");

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  // No Authorization header
  if (!authHeader) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  // Extract token
  const token = authHeader.split(" ")[1];

  // No token
  if (!token) {
    return res.status(401).json({
      message: "Invalid authorization header",
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    // Store authenticated user information
    req.user = decoded;

    // Continue to controller
    next();

  } catch (error) {
    return res.status(403).json({
      message: "Invalid or expired token",
    });
  }
};

module.exports = authenticateToken;

