// Module Imports
var config = require('./config'),
    restler = require('restler'),
    distance = require('jaro-winkler'),
    cron = require('node-cron')
    stopword = require('stopword');

// Authenticate with Reddit API
restler.post('https://www.reddit.com/api/v1/access_token', {
    username: config.id,
    password: config.secret,
    data: {
      grant_type: "password",
      username: config.username,
      password: config.password
    }
}).on("complete", function(auth) {
    // Prepare to Hold Handled Posts
    var handled = [];
    // Begin Timer
    cron.schedule("*/3 * * * * *", function() {
        // Get Latest Post from Subreddit
        restler.get("https://oauth.reddit.com/r/" + config.subreddit + "/new.json?limit=1", {
            accessToken: auth.access_token
        }).on("complete", function(data) {
            // Check if Reddit Responded Correctly
            if (data.data && data.data.children && data.data.children[0] && data.data.children[0].data) {
                // Check if Post has Been Previously Handled
                if (handled.indexOf(data.data.children[0].data.id) === -1) {
                    // Add Post to Handled List
                    handled.push(data.data.children[0].data.id);
                    // Check if User is Exempt
                    if (config.ignore.indexOf(data.data.children[0].data.author) === -1) {
                        // Build Search Query
                        var query = stopword.removeStopwords(data.data.children[0].data.title.split(" ")).join("+");
                        // Search
                        // restler.get("https://oauth.reddit.com/r/" + config.subreddit + "/search.json?limit=100&restrict_sr=on&sort=new&t=all&q=" + query, {
                        restler.get("https://oauth.reddit.com/r/Twitch/search.json?limit=100&restrict_sr=on&sort=new&t=all&q=" + query, {
                            accessToken: auth.access_token
                        }).on("complete", function(search) {
                            // Check if Reddit Responded Correctly
                            if (search && search.data && search.data.children) {
                                // Prepare for Loop of Results
                                var results = search.data.children,
                                    posts = [];

                                // Begin Loop
                                for (var result of results) {
                                    // Ignore the Same Post
                                    if (data.data.children[0].data.id != result.data.id) {
                                        // Check for Similarities
                                        var difference = distance(stopword.removeStopwords(data.data.children[0].data.title.split(" ")).join(" "), stopword.removeStopwords(result.data.title.split(" ")).join(" "), { caseSensitive: false });
                                        // Depreciate due to Post Age
                                        var now = parseInt(Date.now() / 1000),
                                            age = now - result.data.created_utc,
                                            depreciation = parseInt(age / 2592000) * 0.02;
                                            difference = difference - depreciation;
                                        
                                        // Check if Post is Relevant & Has Comments/Edit
                                        if (difference >= 0.75 && (result.data.num_comments > 0 || result.data.edited)) {
                                            // Add Result to List of Possible Suggestions
                                            posts.push({
                                                title: result.data.title,
                                                url: "https://redd.it/" + result.data.id,
                                                difference: parseInt(difference * 100)
                                            });
                                        }
                                    }
                                }
                                // Check for Results
                                if (posts.length > 0) {
                                    // Sort List of Suggestions
                                    posts.sort(function(a, b) {
                                        return b.difference - a.difference;
                                    });
                                    // Limit to 5 Suggestions
                                    posts.splice(5);
                                    // Build Comment
                                    var comment = `Greetings /u/` + data.data.children[0].data.author + `,

As part of an attempt to cut back on the number of repetitive threads on /r/` + config.subreddit + `, we are trying to provide a short list of posts from Reddit's search function which may help you. The search found the following results for you:

`
                                    for (var post of posts) {
                                        comment = comment + `- [` + post.title + `](` + post.url + `) (` + post.difference + `% Relevancy Chance)
`
                                    }
                                    comment = comment + `
If the suggested links are irrelvant to your question, feel free to ignore this comment. You may want to also upvote or downvote this comment to give the subreddit moderators an indication of how well the bot is doing! [Also, we recommend looking at the /r/` + config.subreddit + ` Wiki for answers to frequently asked questions.](https://www.reddit.com/r/` + config.subreddit + `/wiki/)

*I'm a bot and this action was performed automatically. If you have any questions or concerns, please contact the subreddit moderators via [modmail](https://www.reddit.com/message/compose?to=%2Fr%2F` + config.subreddit + `).*`
                                    // Submit Comment
                                    restler.post('https://oauth.reddit.com/api/comment', {
                                        accessToken: auth.access_token,
                                        data: {
                                            api_type: "json",
                                            text: comment,
                                            thing_id: "t3_" + data.data.children[0].data.id
                                        }
                                    }).on("complete", function(submission) {
                                        // Distinguish Comment
                                        restler.post('https://oauth.reddit.com/api/distinguish', {
                                            accessToken: auth.access_token,
                                            data: {
                                                api_type: "json",
                                                id: "t1_" + submission.json.data.things[0].data.id,
                                                how: "yes",
                                                sticky: config.sticky_comments
                                            }
                                        }).on("complete", function(distinguish) {
                                            // Report Original Post
                                            restler.post('https://oauth.reddit.com/api/report', {
                                                accessToken: auth.access_token,
                                                data: {
                                                    api_type: "json",
                                                    thing_id: "t3_" + data.data.children[0].data.id,
                                                    reason: "other",
                                                    other_reason: "Possible Repetitive Topic Detected (See Comments)"
                                                }
                                            });
                                        });
                                    });
                                }
                            }
                        });
                    }
                }
            }
        });
    });
});

console.log("Bot Running")