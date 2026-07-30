const fs = require('fs');
let code = fs.readFileSync('main.cjs', 'utf-8');
if (!code.includes('setPermissionCheckHandler')) {
  code = code.replace(
    "app.on('ready', () => {",
    "app.on('ready', () => {\n  const { session } = require('electron');\n  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {\n    if (permission === 'media') {\n      callback(true);\n    } else {\n      callback(false);\n    }\n  });\n  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {\n    if (permission === 'media') {\n      return true;\n    }\n    return false;\n  });\n"
  );
  fs.writeFileSync('main.cjs', code);
}
