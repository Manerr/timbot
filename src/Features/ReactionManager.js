const Feature = require('./Base/Feature');
const Timbot = require('../Core/Timbot');

/**
 * Manages the Discord bot's current activity / status.
 */
class ReactionManager extends Feature {
    constructor() {
        super();

        this._data = {};

        this._handleApiWriteReaction = this._handleApiWriteReaction.bind(this);
        this._handleApiReactionDelete = this._handleApiReactionDelete.bind(this);
        this._handleApiReactionsFetch = this._handleApiReactionsFetch.bind(this);
        this._handleDiscordMessage = this._handleDiscordMessage.bind(this);
    }

    // -----------------------------------------------------------------------------------------------------------------

    /**
     * @inheritDoc
     */
    enable() {
        // Load all reactions from the database
        this.dbc = Timbot.db.connection;
        this.reloadAll();

        // Register API routes
        Timbot.api.registerApi(ReactionManager.API_OP_REACTION_WRITE, this._handleApiWriteReaction);
        Timbot.api.registerApi(ReactionManager.API_OP_REACTION_DELETE, this._handleApiReactionDelete);
        Timbot.api.registerApi(ReactionManager.API_OP_REACTIONS_FETCH, this._handleApiReactionsFetch);

        // Register message filter
        Timbot.messenger.registerFilter(this._handleDiscordMessage);
    }

    /**
     * @inheritDoc
     */
    disable() {
        // Unregister routes
        Timbot.api.unregisterApi(ReactionManager.API_OP_REACTION_WRITE, this._handleApiWriteReaction);
        Timbot.api.unregisterApi(ReactionManager.API_OP_REACTION_DELETE, this._handleApiReactionDelete);
        Timbot.api.unregisterApi(ReactionManager.API_OP_REACTIONS_FETCH, this._handleApiReactionsFetch);

        // Unregister message filter
        Timbot.messenger.unregisterFilter(this._handleDiscordMessage);

        // Clear memory
        this._data = null;
        this.dbc = null;
    }

    /**
     * @inheritDoc
     */
    handleEvent(eventName, data) {
        // ...
    }

    // -----------------------------------------------------------------------------------------------------------------

    _handleApiWriteReaction(ws, data) {
        // Received a request to insert or update a reaction
        let id = parseInt(data.id) || null;

        let upsertData = {
            id: id,

            type: data.type || null,
            trigger: data.trigger || null,
            must_mention: parseInt(data.must_mention) === 1 ? 1 : 0,
            insensitive: parseInt(data.insensitive) === 1 ? 1 : 0,

            response: data.response || null,
            emote: (data.emote || "").trim() || null,
            do_mention: parseInt(data.do_mention) === 1 ? 1 : 0
        };

        let result = Timbot.db.insertOrUpdate("reactions", upsertData);

        if (result === false) {
            return false;
        }

        let recordId = parseInt(result);

        if (!upsertData.id && recordId) {
            upsertData.id = recordId;
        }

        this._data[recordId] = upsertData;
    }

    _handleApiReactionDelete(ws, data) {
        let id = parseInt(data.id) || null;

        if (id && id > 0) {
            if (Timbot.db.deleteIfExists("reactions", id)) {
                delete this._data[id];
            }

            this._handleApiReactionsFetch(ws, null);
        }
    }

    _handleApiReactionsFetch(ws, data) {
        // Received a request to list all reactions
        let rows = Object.values(this._data);

        let payload = {
            op: ReactionManager.API_OP_REACTIONS_FETCH,
            reactions: rows
        };

        ws.send(JSON.stringify(payload));
    }

    _handleDiscordMessage(client, message) {
        if (message.author.bot || message.system) {
            // Ignore bots to prevent getting potentially stuck in a reaction loop
            // Ignore system events because they're not useful to us
            return;
        }

        let cleanText = message.cleanContent.trim();

        if (!cleanText.length) {
            // Ignore empty messages
            return;
        }

        let isDirectMessage = message.channel.type === "dm";
        let didMentionUs = isDirectMessage || message.isMentioned(client.user);

        let matchingReactions = Object.values(this._data).filter((reaction) => {
            if (!reaction.trigger) {
                // Invalid / incomplete record
                return false;
            }

            if (reaction.must_mention && !didMentionUs) {
                // Reaction must be mentioned, but have no mention, ignore.
                return false;
            }

            let chatNormal = cleanText;
            let triggerNormal = reaction.trigger;

            if (reaction.insensitive) {
                // Lowercase both
                chatNormal = chatNormal.toLowerCase();
                triggerNormal = triggerNormal.toLowerCase();

                // Remove "grammatical punctuation"
                chatNormal = chatNormal.replaceAll("!", "");
                chatNormal = chatNormal.replaceAll("?", "");
                chatNormal = chatNormal.replaceAll("'", "");
                chatNormal = chatNormal.replaceAll('"', "");
                chatNormal = chatNormal.replaceAll(",", "");
                chatNormal = chatNormal.replaceAll(".", "");
            }

            switch (reaction.type) {
                case ReactionManager.TYPE_KEYWORD:
                    // Message: Keyword(s) boundary match
                    return chatNormal.match(new RegExp("\\b" + triggerNormal + "\\b", "gm")) !== null;
                case ReactionManager.TYPE_MESSAGE:
                    // Message: Exact match
                    return chatNormal === triggerNormal;
                default:
                case ReactionManager.TYPE_TEXT:
                    // Message: Substring match
                    return chatNormal.indexOf(triggerNormal) >= 0;
            }
        });

        matchingReactions.forEach((reaction) => {
            this._deliverReaction(client, message, reaction);
        });
    }

    // -----------------------------------------------------------------------------------------------------------------

    _deliverReaction(client, message, reaction) {
        if (reaction.emote) {
            // Add emoji/emote reactions to the original message
            // We'll allow multiple emotes in reaction spec separated by space
            let emotes = reaction.emote.split(' ');

            emotes.forEach((emote) => {
                // Each emote is either a straight emoji or a Discord emote, e.g. ":tada:"
                // For the latter we need to do a lookup
                if (emote.startsWith(":") && emote.endsWith(":")) {
                    let emoteVal = emote.substr(1, emote.length - 2); // remove colons for lookup
                    let discordEmoji = client.emojis.find(e => e.name === emoteVal);

                    if (discordEmoji) {
                        // We have a Discord emoji (a custom server one) to react with
                        message.react(discordEmoji.id)
                            .catch((err) => {
                                Timbot.log.w(_("[Reactions] Could not react with resolved Discord emote `{0}` <{2}>: {1}", emote, err, discordEmoji.id));
                            });
                    } else {
                        Timbot.log.w(_("[Reactions] Could not react, unable to resolve Discord emote `{0}`.", emote));
                    }
                } else {
                    // Probably a unicode emoji
                    message.react(emote)
                        .catch((err) => {
                            Timbot.log.w(_("[Reactions] Could not react with emote `{0}`: {1}", emote, err));
                        });
                }
            });
        }

        if (reaction.response) {
            let msgContent = reaction.response;

            let isDirectMessage = message.channel.type === "dm";
            let shouldMention = !isDirectMessage && reaction.do_mention;

            if (shouldMention) {
                msgContent = `<@${message.author.id}> ` + msgContent;
            }

            Timbot.log.d(_("[Reactions] `{1}` >>> `{0}`", msgContent, message.cleanContent));

            try {
                message.channel.send(msgContent);
            } catch (e) {
                Timbot.log.w(_("[Reactions] Could not respond with message `{0}`: {1}", msgContent, e.message));
            }
        }
    }

    // -----------------------------------------------------------------------------------------------------------------

    /**
     * (Re)loads all reactions from the database.
     */
    reloadAll() {
        try {
            let allRows = this.dbc.prepare('SELECT * FROM reactions;').all();
            Timbot.log.d(_("[Reactions] Loaded {0} reactions from database.", allRows.length));

            this._data = {};

            allRows.forEach((row) => {
                this._data[row.id] = row;
            });

            return true;
        } catch (e) {
            Timbot.log.e(_("[Reactions] Unable to load reactions from database: {0}", e.message));
            return false;
        }
    }
}

ReactionManager.API_OP_REACTION_WRITE = "reaction_write";
ReactionManager.API_OP_REACTION_DELETE = "reaction_delete";
ReactionManager.API_OP_REACTIONS_FETCH = "reactions_fetch";

ReactionManager.TYPE_KEYWORD = "keyword";
ReactionManager.TYPE_TEXT = "text";
ReactionManager.TYPE_MESSAGE = "message";

module.exports = ReactionManager;
