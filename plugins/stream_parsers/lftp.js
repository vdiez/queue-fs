module.exports = {
    parse(data, stderr) {
        if (data instanceof Buffer) {
            data = data.toString('utf8');
            console.log(this.data)
            if (stderr) this.data.stderr += data;
            else this.data.stderr += data;
        }
        let match_progress = data.match(/(\d+) of (\d+) \((\d+)%\)/);
        if (match_progress) {
            this.data.current = Number(match_progress[1]);
            this.data.total = Number(match_progress[2]);
            if (Number(match_progress[3]) !== this.data.percentage) {
                this.data.percentage = Number(match_progress[3]);
                if (this.publish) this.publish(this.data);
            }
        }
    }
};