let fs = require('fs-extra');

module.exports = function(actions) {
    if (!actions.hasOwnProperty('truncate')) {
        actions.truncate = function(params) {
            return new Promise(function (resolve, reject) {
                fs.writeFile(params.source, '', function (err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        };
    }
    return actions;
};