module.exports = params => {
    let actions = [];
    params.cmd = "speedtest-cli --simple";
    params.progress = "speedtest";
    actions.push({id: "speedtest", action: "local", critical:true, params: params});
    return actions;
};