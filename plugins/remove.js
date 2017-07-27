let fs = require('fs-extra');

module.exports = function(actions) {
    if (!actions.hasOwnProperty('remove')) {
        actions.remove = function(params) {
            return new Promise(function (resolve, reject) {
                fs.remove(params.source, function (err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        };
    }
    return actions;
};