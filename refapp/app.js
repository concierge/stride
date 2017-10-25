"use strict";

const _ = require('lodash');
const fs = require('fs');
const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const cors = require('cors');
const jsonpath = require('jsonpath');
const {Document} = require('adf-builder');
const prettyjson = require('prettyjson');

function prettify_json(data, options = {}) {
  return '{\n' + prettyjson.render(data, options) + '\n}';
}

const {PORT = 8000, CLIENT_ID, CLIENT_SECRET, ENV = 'production'} = process.env;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.log("Usage:");
  console.log("PORT=<http port> CLIENT_ID=<app client ID> CLIENT_SECRET=<app client secret> node app.js");
  process.exit();
}


const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(express.static('.'));


/**
 * Simple library that wraps the Stride REST API
 */
const stride = require('./stride').factory({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  env: ENV,
});

/**
 * This implementation doesn't make any assumption in terms of data store, frameworks used, etc.
 * It doesn't have proper persistence, everything is just stored in memory.
 */
const configStore = {};
const installationStore = {};


/**
 * Installation lifecycle
 * ----------------------
 * When a user installs or uninstalls your app in a conversation,
 * Stride makes a REST call to an endpoint specified in the app descriptor:
 *       "lifecycle": {
 *           "installed": "/some/url",
 *           "uninstalled": "/some/url"
 *       }
 * At installation, Stride sends the context of the installation: cloudId, conversationId, userId
 * You can store this information for later use.
 */
app.post('/installed', (req, res, next) => {
  console.log('app installed in a conversation');
  const {cloudId, userId} = req.body;
  const conversationId = req.body.resourceId;

  // Store the installation details
  if (!installationStore[conversationId]) {
    installationStore[conversationId] = {
      cloudId,
      conversationId,
      installedBy: userId
    }
    console.log('Persisted for this conversation:', JSON.stringify(installationStore[conversationId]));
  }
  else
    console.log('Known data for this conversation:', JSON.stringify(installationStore[conversationId]));


  // Send a message to the conversation to announce the app is ready
  stride.sendTextMessage({
      cloudId,
      conversationId,
      text: "Hi there! Thanks for adding me to this conversation. To see me in action, just mention me in a message",
    })
    .then(() => res.sendStatus(200))
    .catch(next)
});

app.post('/uninstalled', (req, res) => {
  console.log('app uninstalled from a conversation');
  const conversationId = req.body.resourceId;

  // note: we can't send message in the room anymore

  // Remove the installation details
  installationStore[conversationId] = null;

  res.sendStatus(204);
});


/**
 * chat:bot
 * --------
 * This function is called anytime a user mentions the bot in a conversation.
 * You first need to declare the bot in the app descriptor:
 * "chat:bot": [
 *   {
 *     "key": "refapp-bot",
 *     "mention": {
 *      "url": "https://740a1ad5.ngrok.io/bot-mention"
 *     }
 *   }
 * ]
 *
 */

app.post('/bot-mention',
  stride.validateJWT,
  (req, res, next) => {
    console.log('* bot mention', prettify_json(req.body));
    const message = req.body;
    const {cloudId} = req.body;
    const conversationId = req.body.conversation.id;
    const senderId = req.body.message.sender.id;

    /*showCase({cloudId, conversationId, message})
      .then(() => res.sendStatus(200))*/
    let user; // see getAndReportUserDetails
    stride.replyWithText({
        message,
        text: "OK, I'm on it!",
      })
      // If you don't send a 200, Stride will try to resend it
      .then(() => res.sendStatus(200))
      // Now let's do all the things:
      .then(convertMessageToPlainTextAndReportIt)
      .then(extractAndSendMentions)
      .then(getAndReportUserDetails)
      .then(sendPrivateMessage)
      .then(sendMessageWithFormatting)
      .then(sendMessageWithImage)
      .then(updateGlance)
      .then(allDone)
      .catch(next);

    async function convertMessageToPlainTextAndReportIt() {
      console.log('  * convertMessageToPlainTextAndReportIt...');

      await stride.replyWithText({
        message,
        text: "Converting the message you just sent to plain text...",
      });

      // The message is in req.body.message. It is sent using the Atlassian document format.
      // A plain text representation is available in req.body.message.text
      const messageText = req.body.message.text;
      console.log("    Message in plain text: " + messageText);

      // You can also use a REST endpoint to convert any Atlassian document to a plain text representation:
      const msgInText = await stride.convertDocToText(req.body.message.body);
      console.log("    Message converted to text: " + msgInText);

      const doc = new Document();
      doc.paragraph()
        .text("In plain text, it looks like this:");
      doc.paragraph()
        .text(`"${msgInText}"`);
      const document = doc.toJSON();

      await stride.reply({message, document});
    }

    async function extractAndSendMentions() {
      console.log('  * extractAndSendMentions...');
      const doc = new Document();

      const paragraph = doc.paragraph()
        .text('The following people were mentioned: ');
      // Here's how to extract the list of users who were mentioned in this message
      const mentionNodes = jsonpath.query(req.body, '$..[?(@.type == "mention")]');

      // and how to mention users
      mentionNodes.forEach(function (mentionNode) {
          const userId = mentionNode.attrs.id;
          const userMentionText = mentionNode.attrs.text;
          // If you don't know the user's mention text, call the User API - stride.getUser()
          paragraph.mention(userId, userMentionText);
        }
      );

      const document = doc.toJSON();
      await stride.reply({message, document});
    }

    async function getAndReportUserDetails() {
      await stride.replyWithText({message, text: "Getting user details for the sender of the message"});
      user = await stride.getUser({cloudId, userId: senderId});
      await stride.replyWithText({message, text: "This message was sent by " + user.displayName});
    }

    async function sendPrivateMessage() {
      await stride.replyWithText({message, text: "Now sending you a private message…"});
      try {
        await stride.sendPrivateMessage({
          cloudId,
          userId: senderId,
          document: await stride.createDocMentioningUser({
            cloudId,
            userId: senderId,
            text: 'Beware {{MENTION}}, I know where you live...',
          })
        })
      }
      catch (e) {
        await stride.replyWithText({message, text: "Didn't work, but maybe you closed our private conversation? Try re-opening it... (please)"});
      }
    }

    async function sendMessageWithFormatting() {
      await stride.replyWithText({message, text: "Sending a message with plenty of formatting..."});

      // Here's how to send a reply with a nicely formatted document, using the document builder library adf-builder
      const doc = new Document();
      doc.paragraph()
        .text('Here is some ')
        .strong('bold test')
        .text(' and ')
        .em('text in italics')
        .text(' as well as ')
        .link(' a link', 'https://www.atlassian.com')
        .text(' , emojis ')
        .emoji(':smile:')
        .emoji(':rofl:')
        .emoji(':nerd:')
        .text(' and some code: ')
        .code('const i = 0;')
        .text(' and a bullet list');
      doc.bulletList()
        .textItem('With one bullet point')
        .textItem('And another');
      doc.panel("info")
        .paragraph()
        .text("and an info panel with some text, with some more code below");
      doc.codeBlock("javascript")
        .text('const i = 0;\nwhile(true) {\n  i++;\n}');

      doc
        .paragraph()
        .text("And a card");
      const card = doc.applicationCard('With a title')
        .link('https://www.atlassian.com')
        .description('With some description, and a couple of attributes')
        .background('https://www.atlassian.com');
      card.detail()
        .title('Type')
        .text('Task')
        .icon({
          url: 'https://ecosystem.atlassian.net/secure/viewavatar?size=xsmall&avatarId=15318&avatarType=issuetype',
          label: 'Task'
        })
      card.detail()
        .title('User')
        .text('Joe Blog')
        .icon({
          url: 'https://ecosystem.atlassian.net/secure/viewavatar?size=xsmall&avatarId=15318&avatarType=issuetype',
          label: 'Task'
        })
      const document = doc.toJSON();

      await stride.reply({message, document});
    }

    async function sendMessageWithImage() {
      await stride.replyWithText({ message, text: "Uploading an image and sending it in a message..." });

      // To send a file or an image in a message, you first need to upload it
      const https = require('https');
      const imgUrl = 'https://media.giphy.com/media/L12g7V0J62bf2/giphy.gif';

      return new Promise((resolve, reject) => {
        https.get(imgUrl, function (downloadStream) {
          stride.sendMedia({
              cloudId,
              conversationId,
              name: "an_image2.jpg",
              stream: downloadStream,
            })
            .then(JSON.parse)
            .then(response => {
              if (!response || !response.data)
                throw new Error('Failed to upload media!')

              // Once uploaded, you can include it in a message
              const mediaId = response.data.id;
              const doc = new Document();
              doc.paragraph()
                .text("and here's that image");
              doc
                .mediaGroup()
                .media({type: 'file', id: mediaId, collection: conversationId});

              return stride.reply({message, document: doc.toJSON()})
            })
            .then(resolve, reject);
        });
      });
    }

    async function updateGlance() {
      await stride.replyWithText({ message, text: "Updating the glance state..." });

      // Here's how to update the glance state
      const stateTxt = `Click me, ${user.displayName} !!`;
      await stride.updateGlanceState({
        cloudId,
        conversationId,
        glanceKey: "refapp-glance",
        stateTxt,
      });
      console.log("glance state updated to: " + stateTxt);
      await stride.replyWithText({ message, text: `It should be updated to "${stateTxt}" -->` });
    }

    async function allDone() {
      await stride.replyWithText({ message, text: "OK, I'm done. Thanks for watching!" });
      console.log("all done.");
    }
  }
);


/**
 * core:webhook
 *
 * Your app can listen to specific events, like users joining/leaving conversations, or conversations being created/updated
 * Note: webhooks will only fire for conversations your app is authorized to access
 */

app.post('/conversation-updated',
  stride.validateJWT,
  (req, res) => {
    console.log('A conversation was changed: ' + req.body.conversation.id + ', change: ' + req.body.action);
    res.sendStatus(200);
  }
);

app.post('/roster-updated',
  stride.validateJWT,
  (req, res) => {
    console.log('A user joined or left a conversation: ' + req.body.conversation.id + ', change: ' + req.body.action);
    res.sendStatus(200);
  }
);

/**
 * chat:configuration
 * ------------------
 * Your app can expose a configuration page in a dialog inside the Stride app. You first declare it in the descriptor:
 * TBD
 */

app.get('/module/config',
  stride.validateJWT,
  (req, res) => {
    res.redirect("/app-module-config.html");
  }
);

// Get the configuration state: is it configured or not for the conversation?
app.get('/module/config/state',
  // cross domain request
  cors(),
  stride.validateJWT,
  (req, res) => {
    const conversationId = res.locals.context.conversationId;
    console.log("getting config state for conversation " + conversationId);
    const config = configStore[res.locals.context.conversationId];
    const state = {configured: true};
    if (!config)
      state.configured = false;
    console.log("returning config state: " + JSON.stringify(state));
    res.send(JSON.stringify(state));
  }
);

// Get the configuration content from the configuration dialog
app.get('/module/config/content',
  stride.validateJWT,
  (req, res) => {
    const conversationId = res.locals.context.conversationId;
    console.log("getting config content for conversation " + conversationId);
    const config = configStore[res.locals.context.conversationId] || {notificationLevel: "NONE"};
    res.send(JSON.stringify(config));
  }
);

// Save the configuration content from the configuration dialog
app.post('/module/config/content',
  stride.validateJWT,
  (req, res, next) => {
    const cloudId = res.locals.context.cloudId;
    const conversationId = res.locals.context.conversationId;
    console.log("saving config content for conversation " + conversationId + ": " + JSON.stringify(req.body));
    configStore[conversationId] = req.body;

    stride.updateConfigurationState(cloudId, conversationId, 'refapp-config', true)
      .then(() => res.sendStatus(204))
      .catch(next);
  }
);


app.get('/module/dialog',
  stride.validateJWT,
  (req, res) => {
    res.redirect("/app-module-dialog.html");
  }
);

/**
 * chat:glance
 * ------------
 * To contribute a chat:glance to the Stride right sidebar, declare it in the app descriptor
 *  "chat:glance": [
 * {
 *   "key": "refapp-glance",
 *  "name": {
 *     "value": "App Glance"
 *   },
 *   "icon": {
 *     "url": "/icon.png",
 *     "url@2x": "/icon.png"
 *   },
 *   "target": "refapp-sidebar",
 *   "queryUrl": "/module/glance/state"
 * }
 * ]
 * This adds a glance to the sidebar. When the user clicks on it, Stride opens the module whose key is specified in "target".
 *
 * When a user first opens a Stride conversation where the app is installed,
 * the Stride app makes a REST call to the queryURL to get the initial value for the glance.
 * You can then update the glance for a conversation at any time by making a REST call to Stride.
 * Stride will then make sure glances are updated for all connected Stride users.
 **/

app.get('/module/glance/state',
  // cross domain request
  cors(),
  stride.validateJWT,
  (req, res) => {
    res.send(
      JSON.stringify({
        "label": {
          "value": "Click me!"
        }
      }));
  }
);

/*
 * chat:sidebar
 * ------------
 * When a user clicks on the glance, Stride opens an iframe in the sidebar, and loads a page from your app,
 * from the URL specified in the app descriptor
 * 		"chat:sidebar": [
 * 		 {
 * 		    "key": "refapp-sidebar",
 * 		    "name": {
 * 		      "value": "App Sidebar"
 * 		    },
 * 		    "url": "/module/sidebar",
 * 		    "authentication": "jwt"
 * 		  }
 * 		]
 **/

app.get('/module/sidebar',
  stride.validateJWT,
  (req, res) => {
    res.redirect("/app-module-sidebar.html");
  }
);

/**
 * Making a call from the app front-end to the app back-end:
 * You can find the context for the request (cloudId, conversationId) in the JWT token
 */

app.post('/ui/ping',
  stride.validateJWT,
  (req, res) => {
    console.log('Received a call from the app frontend ' + JSON.stringify(req.body));
    const cloudId = res.locals.context.cloudId;
    const conversationId = res.locals.context.conversationId;
    stride.sendTextMessage(cloudId, conversationId, "Pong")
      .then(() => res.send(JSON.stringify({status: "Pong"})))
      .catch(() => res.send(JSON.stringify({status: "Failed"})))
  }
);


/**
 * Your app has a descriptor (app-descriptor.json), which tells Stride about the modules it uses.
 *
 * The variable ${host} is substituted based on the base URL of your app.
 */

app.get('/descriptor', (req, res) => {
  fs.readFile('./app-descriptor.json', (err, descriptorTemplate) => {
    const template = _.template(descriptorTemplate);
    const descriptor = template({
      host: 'https://' + req.headers.host
    });
    res.set('Content-Type', 'application/json');
    res.send(descriptor);
  });
});


app.use(function errorHandler(err, req, res, next) {
  if (!err) err = new Error('unknown error')
  console.error({err}, 'app error handler: request failed!');
  const status = err.httpStatusHint || 500;
  res.status(status).send(`Something broke! Our devs are already on it! [${status}: ${http.STATUS_CODES[status]}]`);
  process.exit(1) // XXX DEBUG
});

http.createServer(app).listen(PORT, function () {
  console.log('App running on port ' + PORT);
});
