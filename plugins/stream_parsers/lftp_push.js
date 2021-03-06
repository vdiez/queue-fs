module.exports = {
    parser(data) {
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