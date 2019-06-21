module.exports = function(actions) {
    if (!actions.hasOwnProperty('wait')) actions.wait = (file, params) => new Promise(resolve => setTimeout(() => resolve(), (params && params.duration) || 10000));
    return actions;
};