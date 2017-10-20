const _ = require('lodash');
const fs = require('fs');
const expressLib = require('express');
const bodyParser = require('body-parser');
const jwtUtil = require('jwt-simple');
const http = require('http');
const request = require('request');
const cors = require('cors');
const jsonpath = require('jsonpath');
const express = expressLib();
const { Document } = require('adf-builder');
express.use(bodyParser.json());
express.use(bodyParser.urlencoded({extended: true}));
express.use(expressLib.static('.'));

const PORT = process.env.PORT;
const app = {};
app.clientId = process.env.CLIENT_ID;
app.clientSecret = process.env.CLIENT_SECRET;
app.environment = process.env.ENV ? process.env.ENV : "production";

if (!PORT || !app.clientId || !app.clientSecret) {
  console.log ("Usage:");
  console.log("PORT=<http port> CLIENT_ID=<app client ID> CLIENT_SECRET=<app client secret> node app.js");
  process.exit();
}

/**
 * Simple library that wraps the Stride REST API
 */
const stride = require('./stride')(app);

/**
 * This implementation doesn't make any assumption in terms of data store, frameworks used, etc.
 * It doesn't have proper persistence, everything is just stored in memory.
 */
const configStore = {};
const installationStore = {};

/**
 * Securing your app with JWT
 * --------------------------
 * Whenever Stride makes a call to your app (webhook, glance, sidebar, bot), it passes a JSON Web Token (JWT).
 * This token contains information about the context of the call (cloudId, conversationId, userId)
 * This token is signed, and you should validate the signature, which guarantees that the call really comes from Stride.
 * You validate the signature using the app's client secret.
 *
 * In this tutorial, the token validation is implemented as an Express middleware function which is executed
 * in the call chain for every request the app receives from Stride.
 * The function extracts the context of the call from the token and adds it to a local variable.
 */

function getJWT(req) {
  //Extract the JWT token from the request
  //Either from the "jwt" request parameter
  //Or from the "authorization" header, as "Bearer xxx"
  const encodedJwt = req.query['jwt']
      || req.headers['authorization'].substring(7)
      || req.headers['Authorization'].substring(7);

  // Decode the base64-encoded token, which contains the context of the call
  const decodedJwt = jwtUtil.decode(encodedJwt, null, true);

  const jwt = {encoded: encodedJwt, decoded: decodedJwt};
  return jwt;
}

function validateJWT(req, res, next) {
  try {

    const jwt = getJWT(req);

    const conversationId = jwt.decoded.context.resourceId;
    const cloudId = jwt.decoded.context.cloudId;
    const userId = jwt.decoded.sub;

    // Validate the token signature using the app's OAuth secret (created in DAC App Management)
    // (to ensure the call comes from Stride)
    jwtUtil.decode(jwt.encoded, app.clientSecret);

    //all good, it's from Stride, add the context to a local variable
    res.locals.context = {cloudId: cloudId, conversationId: conversationId, userId: userId};

    // Continue with the rest of the call chain
    console.log('Valid JWT');
    next();
  } catch (err) {
    console.log('Invalid JWT');
    res.sendStatus(403);
  }
}

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
express.post('/installed',
    function (req, res) {
      console.log('app installed in a conversation');
      const cloudId = req.body.cloudId;
      const conversationId = req.body.resourceId;
      const userId = req.body.userId;


      // Store the installation details
      if (!installationStore[conversationId]) {
        installationStore[conversationId] = {
          cloudId: cloudId,
          conversationId: conversationId,
          installedBy: userId
        }
      }

      console.log(JSON.stringify(installationStore[conversationId]));

      res.sendStatus(200);

      // Send a message to the conversation to announce the app is ready
      stride.sendTextMessage(cloudId, conversationId, "Hi there! Thanks for adding me to this conversation. To see me in action, just mention me in a message", function (err, response) {
        if (err)
          console.log(err);
      });
    }
);

express.post('/uninstalled',
    function (req, res) {
      console.log('app uninstalled from a conversation');
      const cloudId = req.body.cloudId;
      const conversationId = req.body.resourceId;
      const userId = req.body.userId;

      // Remove the installation details
      installationStore[conversationId] = null;

      res.sendStatus(204);
    }
);


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

express.post('/bot-mention',
    validateJWT,
    function (req, res) {
      console.log('bot mention');
      const cloudId = req.body.cloudId;
      const conversationId = req.body.conversation.id;
      const senderId = req.body.message.sender.id;

      stride.sendTextReply(req.body, "OK, I'm on it!", function (err, response) {

        // If you don't send a 200, Stride will try to resend it
        res.sendStatus(200);


        // Now let's do all the things:
        convertMessageToPlainText(function () {
          extractAndSendMentions(function () {
            getUserDetails(function () {
              sendMessageWithFormatting(function () {
                sendMessageWithImage(function () {
                  updateGlance(function () {
                    done()
                  });
                })
              })
            })
          })
        })
      });

      function convertMessageToPlainText(next) {

        stride.sendTextReply(req.body, "Converting the message you just sent to plain text...", function (err, response) {

          // The message is in req.body.message. It is sent using the Atlassian document format.
          // A plain text representation is available in req.body.message.text
          const messageText = req.body.message.text;
          console.log("Message in plain text: " + messageText);

          // You can also use a REST endpoint to convert any Atlassian document to a plain text representation:
          stride.convertDocToText(req.body.message.body, function (error, response) {
            console.log("Message converted to text: " + response)

            const doc = new Document();
            doc.paragraph()
                .text("In plain text, it looks like this:");
            doc.paragraph()
                .text('"' + response + '"');
            const reply = doc.toJSON();

            stride.sendDocumentReply(req.body, reply, function (err, response) {
              console.log(response);
              next();
            });
          })
        });
      }

      function extractAndSendMentions(next) {

        doc = new Document();

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

        const reply = doc.toJSON();
        stride.sendDocumentReply(req.body, reply, function (err, response) {
          next();
        });
      }

      function sendMessageWithFormatting(next) {
        stride.sendTextReply(req.body, "Sending a message with plenty of formatting...", function (err, response) {
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
          const reply = doc.toJSON();

          stride.sendDocumentReply(req.body, reply, function (err, response) {
            console.log(response);
            next();
          });
        });
      }

      function sendMessageWithImage(next) {
        stride.sendTextReply(req.body, "Uploading an image and sending it in a message...", function (err, response) {


          // To send a file or an image in a message, you first need to upload it
          const https = require('https');
          const imgUrl = 'https://media.giphy.com/media/L12g7V0J62bf2/giphy.gif';
          https.get(imgUrl, function (downloadStream) {
            stride.sendMedia(cloudId, conversationId, "an_image2.jpg", downloadStream, function (err, response) {

              if (response && JSON.parse(response).data) {

                // Once uploaded, you can include it in a message
                const mediaId = JSON.parse(response).data.id;
                const doc = new Document();
                doc.paragraph()
                    .text("and here's that image");
                doc
                    .mediaGroup()
                    .media({type: 'file', id: mediaId, collection: conversationId});

                const reply = doc.toJSON();
                stride.sendDocumentReply(req.body, reply, function (err, response) {
                  console.log(response);
                  next();
                });
              }
            });
          });
        });
      }

      function getUserDetails(next) {
        stride.sendTextReply(req.body, "Getting user details for the sender of the message", function (err, response) {
          stride.getUser(cloudId, senderId, function (err, body) {
            stride.sendTextReply(req.body, "This message was sent by " + body.displayName, function (err, response) {
              next();
            });
          });
        });
      }

      function updateGlance(next) {
        stride.sendTextReply(req.body, "Updating the glance state...", function (err, response) {
          // Here's how to update the glance state

          stride.updateGlanceState(
              cloudId, conversationId, "refapp-glance", "Click me!!", function (err, response) {
                console.log("glance state updated: " + err + "," + JSON.stringify(response));
                stride.sendTextReply(req.body, "It should be updated -->", function (err, response) {
                  next();
                });
              });

        });
      }

      function done() {
        stride.sendTextReply(req.body, "OK, I'm done. Thanks for watching!", function () {
          console.log("done.");
        });
      }
    }
);


/**
 * core:webhook
 *
 * Your app can listen to specific events, like users joining/leaving conversations, or conversations being created/updated
 * Note: webhooks will only fire for conversations your app is authorized to access
 */

express.post('/conversation-updated',
    validateJWT,
    function (req, res) {
      console.log('A conversation was changed: ' + req.body.conversation.id + ', change: ' + req.body.action);
      res.sendStatus(200);
    });

express.post('/roster-updated',
    validateJWT,
    function (req, res) {
      console.log('A user joined or left a conversation: ' + req.body.conversation.id + ', change: ' + req.body.action);
      res.sendStatus(200);
    });

/**
 * chat:configuration
 * ------------------
 * Your app can expose a configuration page in a dialog inside the Stride app. You first declare it in the descriptor:
 * TBD
 */

express.get('/module/config',
    validateJWT,
    function (req, res) {
      res.redirect("/app-module-config.html");
    });

// Get the configuration state: is it configured or not for the conversation?
express.get('/module/config/state',
    // cross domain request
    cors(),
    validateJWT,
    function (req, res) {
      const conversationId = res.locals.context.conversationId;
      console.log("getting config state for conversation " + conversationId);
      const config = configStore[res.locals.context.conversationId];
      const state = {configured: true};
      if (!config)
        state.configured = false;
      console.log("returning config state: " + JSON.stringify(state));
      res.send(JSON.stringify(state));
    });

// Get the configuration content from the configuration dialog
express.get('/module/config/content',
    validateJWT,
    function (req, res) {
      const conversationId = res.locals.context.conversationId;
      console.log("getting config content for conversation " + conversationId);
      const config = configStore[res.locals.context.conversationId];
      if (!config)
        config = {
          notificationLevel: "NONE"
        }
      res.send(JSON.stringify(config));
    });

// Save the configuration content from the configuration dialog
express.post('/module/config/content',
    validateJWT,
    function (req, res) {
      const cloudId = res.locals.context.cloudId;
      const conversationId = res.locals.context.conversationId;
      console.log("saving config content for conversation " + conversationId + ": " + JSON.stringify(req.body));
      configStore[conversationId] = req.body;

      stride.updateConfigurationState(cloudId, conversationId, 'refapp-config', true, function (err, body) {
        res.sendStatus(204);
      })
    });


express.get('/module/dialog',
    validateJWT,
    function (req, res) {
      res.redirect("/app-module-dialog.html");
    });

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

express.get('/module/glance/state',
    // cross domain request
    cors(),
    validateJWT,
    function (req, res) {
      res.send(
          JSON.stringify({
            "label": {
              "value": "Click me!"
            }
          }));
    });

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

express.get('/module/sidebar',
    validateJWT,
    function (req, res) {
      res.redirect("/app-module-sidebar.html");
    });

/**
 * Making a call from the app front-end to the app back-end:
 * You can find the context for the request (cloudId, conversationId) in the JWT token
 */

express.post('/ui/ping',
    validateJWT,
    function (req, res) {
      console.log('Received a call from the app frontend ' + JSON.stringify(req.body));
      const cloudId = res.locals.context.cloudId;
      const conversationId = res.locals.context.conversationId;
      stride.sendTextMessage(cloudId, conversationId, "Pong", function (err, response) {
        if (!err)
          res.send(JSON.stringify({status: "Pong"}));
        else
          res.send(JSON.stringify({status: "Failed"}));
      })

    }
);


/**
 * Your app has a descriptor (app-descriptor.json), which tells Stride about the modules it uses.
 *
 * The variable ${host} is substituted based on the base URL of your app.
 */

express.get('/descriptor', function (req, res) {
  fs.readFile('./app-descriptor.json', function (err, descriptorTemplate) {
    const template = _.template(descriptorTemplate);
    const descriptor = template({
      host: 'https://' + req.headers.host
    });
    res.set('Content-Type', 'application/json');
    res.send(descriptor);
  });
});


http.createServer(express).listen(PORT, function () {
  console.log('App running on port ' + PORT);
});
