module.exports = {
    parse(data) {
        if (data instanceof Buffer) data = data.toString('utf8');
        let ping = data.match(/\W*ping\s*:\s*(\d+.*)/i);
        if (ping) this.data.ping = ping[1];
        let download = data.match(/\W*download:\s*(\d+.*)/i);
        if (download) this.data.download = download[1];
        let upload = data.match(/\W*upload:\s*(\d+.*)/i);
        if (upload) this.data.upload = upload[1];
    }
};