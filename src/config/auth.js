const basicAuth = require("basic-auth");

const USERNAME = process.env.USERNAME || "admin";
const PASSWORD = process.env.PASSWORD || "password";

const basicAuthMiddleware = (req, res, next) => {
  const credentials = basicAuth(req);
  
  if (!credentials || credentials.name !== USERNAME || credentials.pass !== PASSWORD) {
    res.set("WWW-Authenticate", "Basic realm=\"SDAV File Server\"");
    return res.status(401).json({ 
      error: "Authentication required" 
    });
  }
  
  next();
};

module.exports = { basicAuthMiddleware };