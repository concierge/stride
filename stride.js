"use strict";

const stride_wrapper = require('./stride_rest_wrapper').factory,
  express = require('express'),
  bodyParser = require('body-parser'),
  _ = require('lodash'),
  fs = require('fs'),
  http = require('http');

class StrideIntergrationApi extends shim {
  constructor(commandPrefix, bot, app) {
    super(commandPrefix);
    this._bot = bot;
    this._app = app;
  }

  getUsers() {
    // TODO Implement
    return {}
  }

  async sendMessage(message, threadId) {
    const conversationDetails = this.config.installations[threadId];
    await this._bot.sendTextMessage({cloudId: conversationDetails.cloudId, conversationId: conversationDetails.conversationId, text: message});

  }

}

class StrideIntergration {
  constructor() {
    this._callback = null;
    this._api = null;
    this._server = null
    this.app = null;
  }

  _initialiseBot(config) {
    this.app = express();
    this.app.use(bodyParser.json())
    this.app.use(bodyParser.urlencoded({extended: true}));
    this.app.use(express.static('.'));

    this.stride = stride_wrapper({clientId: config.clientId, clientSecret: config.clientSecret});

    this.app.post('/installed', (req, res, next) => {
      LOG.info('App installed in conversation')
      const cloudId = req.body.cloudId,
        userId = req.body.userId,
        conversationId = req.body.resourceId;

      let message = "";

      if(!this.config.installations) {
        this.config.installations = {};
      }

      if(!this.config.installations[conversationId]) {
        this.config.installations[conversationId] = {
          "cloudId": cloudId,
          "conversationId": conversationId,
          "installedBy": userId
        };

        message = "Hi there! Thanks for adding me to this conversation. To see me in action, just mention me in a message.";

      }

      else {
        message = "Opps, looks like I already exist in this conversation. To see me in action, just mention me in a message.";
      }

      this.stride.sendTextMessage({
        cloudId,
        conversationId,
        text: message
      })
      .then(() => res.sendStatus(200))
      .catch(next);
    });

    this.app.post('/bot-mention', this.stride.validateJWT, (req, res, next) => {
      if (err) {
        LOG.error(err);
        res.sendStatus(500);
        return;
      }

      res.sendStatus(200);
      const reqBody = req.body;
      const event = shim.createEvent(reqBody.conversation.id, reqBody.sender.id, reqBody.sender.displayName, reqBody.message.text)
      if (this._callback) {
        this._callback(this._api, event);
      }
    })

    this.app.get('/descriptor', (req, res) => {
      fs.readFile(__dirname + '/app-descriptor.json', (err, descriptorTemplate) => {
        if (err) {
          //TODO handle error
          res.sendStatus(500);
          return;
        }

        const template = _.template(descriptorTemplate);
        const descriptor = template({
          host: 'https://' + req.headers.host
        });
        res.set('Content-Type', 'application/json');
        res.send(descriptor);
      });
    });


    this.app.use(function errorHandler(err, req, res, next) {
      if (!err) err = new Error('unknown error')
      LOG.error({err}, 'app error handler: request failed!');
      const status = err.httpStatusHint || 500;
      res.status(status).send(`Something broke! Our devs are already on it! [${status}: ${http.STATUS_CODES[status]}]`);
      process.exit(1) // XXX DEBUG
    });

    this._server = http.createServer(this.app).listen(this.config.port, () => {
      LOG.info('Stride webserver running on port ' + this.config.port);
    });

    return this.stride;
  }

  start(callback) {
    if (!this.config.clientId) {
      return LOG.error($$`missing client id`);
    }
    if (!this.config.clientSecret) {
      return LOG.error($$`missing client secret`);
    }

    if (!this.config.port) {
      this.config.port = 8181;
    }

    if (!this.config.botName) {
      this.config.botName = "Concierge";
    }

    this._callback = callback;
    this._api = new StrideIntergrationApi(this.config.commandPrefix, this._initialiseBot(this.config), this.app);

  }

  stop() {
    // Stop the bot
    this._api = null;
    this._callback = null;
  }

  getApi() {
    return this._api;
  }
}

module.exports = new StrideIntergration()
