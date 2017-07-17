module.exports = function(app) {

  function getSampleMessage() {
    return {
        "version": 1,
        "type": "doc",
        "content": [
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "Here is some "
              },
              {
                "type": "text",
                "text": "bold text",
                "marks": [
                  {
                    "type": "strong"
                  }
                ]
              },
              {
                "type": "text",
                "text": " and "
              },
              {
                "type": "text",
                "text": "text in italics, ",
                "marks": [
                  {
                    "type": "em"
                  }
                ]
              },
              {
                "type": "text",
                "text": "bold and in italics",
                "marks": [
                  {
                    "type": "em"
                  },
                  {
                    "type": "strong"
                  }
                ]
              },
              {
                "type": "text",
                "text": " as well as "
              },
              {
                "type": "text",
                "text": "a link",
                "marks": [
                  {
                    "type": "link",
                    "attrs": {
                      "href": "http://www.google.com",
                      "title": "Google"
                    }
                  }
                ]
              },
              {
                "type": "text",
                "text": " and some code: "
              },
              {
                "type": "text",
                "text": "var i = 0;",
                "marks": [
                  {
                    "type": "code"
                  }
                ]
              }
            ]
          },
          {
            "type": "bulletList",
            "content": [
              {
                "type": "listItem",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [
                      {
                        "type": "text",
                        "text": "bullet"
                      }
                    ]
                  }
                ]
              },
              {
                "type": "listItem",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [
                      {
                        "type": "text",
                        "text": "points"
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            "type": "paragraph",
            "content": [
              {
                "type": "text",
                "text": "Another paragraph with "
              },
              {
                "type": "text",
                "text": "strikethrough text",
                "marks": [
                  {
                    "type": "strike"
                  }
                ]
              }
            ]
          },
          {
            "type": "applicationCard",
            "attrs": {
              "text": "And a card",
              "link": {
                "url": "https://www.google.com"
              },
              "title": {
                "text": "And a card"
              },
              "description": {
                "text": "with some description text, and a few attributes"
              },
              "details": [
                {
                  "icon": {
                    "url": "https://ecosystem.atlassian.net/secure/viewavatar?size=xsmall&avatarId=15318&avatarType=issuetype",
                    "label": "Attr"
                  },
                  "title": "This one",
                  "text": "Hello"
                },
                {
                  "title": "That one",
                  "text": "Hey"
                },
                {
                  "lozenge": {
                    "text": "LOZENGE",
                    "appearance": "new",
                    "bold": false
                  },
                  "title": "A lozenge",
                  "text": ""
                },
                {
                  "title": "A user",
                  "text": "This one",
                  "users": [{
                    "icon": {
                      "url": "https://extranet.atlassian.com/download/attachments/3189817539/user-avatar",
                      "label": "This one"
                    }
                  }]
                }
              ]
            }
          }
        ]
    }
  }

  return {
    getSampleMessage: getSampleMessage
  }
}