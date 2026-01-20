const fs = require(\'fs\');
const content = "const chokidar = require(\'chokidar\');ncode here";
fs.writeFileSync(\'PATH_TO_PROJECT/0.1.2/src/modules/subscriptions.js\', content);
