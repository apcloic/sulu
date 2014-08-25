/*
 * This file is part of the Sulu CMS.
 *
 * (c) MASSIVE ART WebServices GmbH
 *
 * This source file is subject to the MIT license that is bundled
 * with this source code in the file LICENSE.
 */

define(['app-config'], function(AppConfig) {

    'use strict';

    var ajax = {
            initiated: false,

            init: function() {
                var def = this.sandbox.data.deferred();
                if (!ajax.initiated) {
                    this.sandbox.dom.on(this.$el, 'focusout', updateEvent.bind(this), '.preview-update');

                    ajax.start.call(this, def);
                    ajax.initiated = true;
                }
                return def;
            },

            update: function(data) {
                var updateUrl = '/admin/content/preview/' + this.data.id + '/update?&webspace=' + this.options.webspace + '&language=' + this.options.language;

                this.sandbox.util.ajax({
                    url: updateUrl,
                    type: 'POST',

                    data: {
                        changes: data
                    }
                });
            },

            start: function(def) {
                var updateUrl = '/admin/content/preview/' + this.data.id + '/start?&webspace=' + this.options.webspace + '&language=' + this.options.language;

                this.sandbox.util.ajax({
                    url: updateUrl,
                    type: 'GET',

                    success: function() {
                        def.resolve();
                    }
                });
            }
        },
        ws = {
            /**
             * returns true if there is a websocket
             * @returns {boolean}
             */
            detection: function() {
                var support = "MozWebSocket" in window ? 'MozWebSocket' : ("WebSocket" in window ? 'WebSocket' : null);
                // no support
                if (support === null) {
                    this.sandbox.logger.log("Your browser doesn't support Websockets.");
                    return false;
                }
                // let's invite Firefox to the party.
                if (window.MozWebSocket) {
                    window.WebSocket = window.MozWebSocket;
                }
                // support exists
                return true;
            },

            init: function() {
                var configSection = AppConfig.getSection('sulu-content'),
                    url = configSection.wsUrl + ':' + configSection.wsPort,
                    def = this.sandbox.data.deferred();

                this.sandbox.logger.log('Connect to url: ' + url);
                ws.socket = new WebSocket(url);

                ws.socket.onopen = function() {
                    this.sandbox.logger.log('Connection established!');
                    this.opened = true;

                    this.sandbox.dom.on(this.formId, 'keyup change', this.updateEvent.bind(this), '.preview-update');

                    // write start message
                    this.writeStartMessage();

                    def.resolve();
                }.bind(this);

                ws.socket.onclose = function() {
                    if (!this.opened) {
                        // no connection can be opened use fallback (safari)
                        this.method = 'ajax';
                        ajax.init.call(this).then(function() {
                            def.resolve();
                        }.bind(this));
                    }
                }.bind(this);

                ws.socket.onmessage = function(e) {
                    var data = JSON.parse(e.data);
                    this.sandbox.logger.log('Message:', data);
                }.bind(this);

                ws.socket.onerror = function(e) {
                    this.sandbox.logger.warn(e);

                    // no connection can be opened use fallback
                    this.method = 'ajax';
                    ajax.init.call(this).then(function() {
                        def.resolve();
                    }.bind(this));
                }.bind(this);

                return def;
            },

            writeStartMessage: function() {
                if (this.method === 'ws') {
                    // send start command
                    var message = {
                        command: 'start',
                        content: this.data.id,
                        type: 'form',
                        user: AppConfig.getUser().id,
                        webspaceKey: this.options.webspace,
                        languageCode: this.options.language,
                        params: {}
                    };
                    ws.socket.send(JSON.stringify(message));
                }
            },

            updateWs: function(changes) {
                if (this.method === 'ws' && ws.socket.readyState === ws.socket.OPEN) {
                    var message = {
                        command: 'update',
                        content: this.data.id,
                        type: 'form',
                        user: AppConfig.getUser().id,
                        webspaceKey: this.options.webspace,
                        languageCode: this.options.language,
                        params: {changes: changes}
                    };
                    ws.socket.send(JSON.stringify(message));
                }
            }
        },

        /**
         * initialize preview with ajax or websocket
         */
        init = function() {
            var def;
            if (!!this.initiated) {
                return;
            }

            if (ws.detection()) {
                def = ws.init.call(this);
            } else {
                def = ajax.init.call(this);
            }
            this.initiated = true;

            this.sandbox.on('sulu.preview.update', function($el, value, changeOnKey) {
                if (!!this.data.id) {
                    var property = this.getSequence($el);
                    if (this.method === 'ws' || !changeOnKey) {
                        update.call(this, property, value);
                    }
                }
            }, this);

            return def.promise();
        },

        update = function(property, value) {
            if (!!this.initiated) {
                var changes = {};
                if (!!property && !!value) {
                    changes[property] = value;
                } else {
                    changes = this.sandbox.form.getData(this.formId);
                }

                if (this.method === 'ws') {
                    ws.update.call(this, changes);
                } else {
                    ajax.update.call(this, changes);
                }
            }
        },

        updateOnly = function() {
            if (!!this.initiated) {
                var changes = {};

                if (this.method === 'ws') {
                    ws.update.call(this, changes);
                } else {
                    ajax.update.call(this, changes);
                }
            }
        },

        /**
         * dom event to redirect changes
         * @param {Object} e
         */
        updateEvent = function(e) {
            if (!!this.data.id && !!this.initiated) {
                var $element = $(e.currentTarget),
                    element = this.sandbox.dom.data($element, 'element');

                update.call(this, this.getSequence($element), element.getValue());
            }
        },

        bindCustomEvents = function() {
            this.sandbox.on('sulu.preview.update-property', function(property, value) {
                update.call(this, property, value);
            }.bind(this));

            this.sandbox.on('sulu.preview.update-only', function() {
                updateOnly.call(this);
            }.bind(this));
        };

    return {
        sandbox: null,
        options: null,
        data: null,
        $el: null,

        initiated: false,
        opened: false,
        method: 'ws',

        formId: '#content-form',

        initialize: function(sandbox, options, data, $el) {
            this.sandbox = sandbox;
            this.options = options;
            this.data = data;
            this.$el = $el;

            init.call(this).then(function() {
                bindCustomEvents.call(this);

                this.sandbox.emit('sulu.preview.initiated');
            }.bind(this));
        },

        getSequence: function($element) {
            $element = $($element);
            var sequence = this.sandbox.dom.data($element, 'mapperProperty'),
                $parents = $element.parents('*[data-mapper-property]'),
                item = $element.parents('*[data-mapper-property-tpl]')[0],
                parentProperty;

            while (!$element.data('element')) {
                $element = $element.parent();
            }

            if ($parents.length > 0) {
                parentProperty = this.sandbox.dom.data($parents[0], 'mapperProperty');
                if (typeof parentProperty !== 'string') {
                    parentProperty = this.sandbox.dom.data($parents[0], 'mapperProperty')[0].data;
                }
                sequence = [
                    parentProperty,
                    $(item).index(),
                    this.sandbox.dom.data($element, 'mapperProperty')
                ];
            }
            return sequence;
        }
    };
});
