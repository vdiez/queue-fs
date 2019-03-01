module.exports = {
    parse(data) {
        if (data instanceof Buffer) {
            data = data.toString('utf8');
            if (stderr) this.data.stderr += data;
            else this.data.stderr += data;
        }
        let match_progress = data.match(/(\d+) \((\d+)%\)/);
        if (match_progress) {
            this.data.current = Number(match_progress[1]);
            if (Number(match_progress[2]) !== this.data.percentage) {
                this.data.percentage = Number(match_progress[2]);
                if (this.publish) this.publish(this.data);
            }
        }
    }
};