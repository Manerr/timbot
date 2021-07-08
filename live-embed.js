const Discord = require('discord.js');
const moment = require('moment');
const humanizeDuration = require("humanize-duration");
const config = require('./config.json');

class LiveEmbed {
  static createForStream(streamData) {
    const isLive = streamData.type === "live";
    const allowBoxArt = config.twitch_use_boxart;

    let msgEmbed = new Discord.MessageEmbed();
    msgEmbed.setColor(isLive ? "#9146ff" : "GREY");
    msgEmbed.setURL(`https://twitch.tv/${(streamData.login || streamData.user_name).toLowerCase()}`);

    // Thumbnail
    let thumbUrl = streamData.profile_image_url;

    if (allowBoxArt && streamData.game && streamData.game.box_art_url) {
      thumbUrl = streamData.game.box_art_url;
      thumbUrl = thumbUrl.replace("{width}", "288");
      thumbUrl = thumbUrl.replace("{height}", "384");
    }

    msgEmbed.setThumbnail(thumbUrl);

    if (isLive) {
      // Title
      msgEmbed.setTitle(`:red_circle: **${streamData.user_name} est en live sur Twitch !**`);
      msgEmbed.addField("Titre", streamData.title, false);
    } else {
      msgEmbed.setTitle(`:white_circle: ${streamData.user_name} était en live sur Twitch.`);
      msgEmbed.setDescription('Le stream est terminé.');

      msgEmbed.addField("Titre", streamData.title, true);
    }

    // Add game
    if (streamData.game) {
      msgEmbed.addField("Jeu", streamData.game.name, false);
    }

    if (isLive) {
      // Add status
      msgEmbed.addField("Statut", isLive ? `En live avec ${streamData.viewer_count} viewers` : 'Le stream est terminé', true);

      // Set main image (stream preview)
      let imageUrl = streamData.thumbnail_url;
      imageUrl = imageUrl.replace("{width}", "1280");
      imageUrl = imageUrl.replace("{height}", "720");
      let thumbnailBuster = (Date.now() / 1000).toFixed(0);
      imageUrl += `?t=${thumbnailBuster}`;
      msgEmbed.setImage(imageUrl);

      // Add uptime
      let now = moment();
      let startedAt = moment(streamData.started_at);

      msgEmbed.addField("Depuis", humanizeDuration(now - startedAt, {
        language: "fr",	
        delimiter: ", ",
        largest: 2,
        round: true,
        units: ["y", "mo", "w", "d", "h", "m"]
      }), true);
    }

    return msgEmbed;
  }
}

module.exports = LiveEmbed;
