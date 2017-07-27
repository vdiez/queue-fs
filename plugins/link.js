let fs = require('fs-extra');

module.exports = function(actions) {
    if (!actions.hasOwnProperty('link')) {
        actions.link = function(params) {
            return new Promise(function (resolve, reject) {
                fs.ensureLink(params.source, params.target, function (err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        };
    }
    return actions;
};