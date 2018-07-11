module.exports = actions => {
    if (!actions.hasOwnProperty('dummy')) actions.dummy = () => new Promise(resolve => setTimeout(() => resolve(), 2000 + Math.floor(Math.random() * 5000)));
    return actions;
};