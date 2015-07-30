/*
 * DiscoJuice
 * Author: Andreas Åkre Solberg, UNINETT, andreas.solberg@uninett.no
 * Licence undecided.
 */
if (typeof DiscoJuice === "undefined") {
    var DiscoJuice = {};
}

String.prototype.startsWith = function(prefix) {
    return this.indexOf(prefix) === 0;
}

DiscoJuice.Control = {
    // Reference to the top level DiscoJuice object
    "parent": DiscoJuice,
    // Reference to the UI object...
    "ui": null,
    // entity data.
    "data": null,
    // data extension
    "customData": null,
    "cookieEntityId": null,
    "quickEntry": null,
    "subsetEnabled": null,
    // Set filter values to filter the result.
    "filters": {},
    "location": null,
    "showdistance": false,
    "maxhits": 25,//0, //25,
    "hitIncrease": 25,
    "extensionResponse": null,
    // Waiter Notification Callback Registry
    "wncr": [],
    "registerCallback": function (callback) {
        this.wncr.push(callback);
        return (this.wncr.length - 1);
    },
    "runCallback": function (i) {
        if (this.wncr[i] && typeof this.wncr[i] === 'function')
            this.wncr[i]();
   },
    // "mergeData": function (data) {
    // 	var i, item, relID;
    // 	for (i = 0; i < data.length; i++) {
    // 		item = data[i];
    // 		relID = item.entityID;
    // 		if (item.subID) {
    // 			relID += '#' + item.subID;
    // 		}
    // 		item['relID'] = relID;
    // 		
    // 		if (!this.alreadyLoaded[relID]) {
    // 			this.data.push(item);
    // 			this.alreadyLoaded[relID] = true;
    // 		}
    // 	}
    // },

    /*
     * Fetching JSON Metadata using AJAX.
     * Callback postLoad is called when data is returned.
     */
    "load": function () {
        var that = this;
        if (this.data)
            return;
        this.data = [];

        this.subsetEnabled = this.parent.Utils.options.get('subsetEnabled', null);

        var inlinemetadata = this.parent.Utils.options.get('inlinemetadata');
        var metadataurl = this.parent.Utils.options.get('metadata');
        var metadataurls = [];
        var parameters = {};
        var curmdurl = null;
        var i, waiter;

        if (typeof metadataurl === 'string') {
            metadataurls.push(metadataurl);
        } else if (typeof metadataurl === 'object' && metadataurl) {
            metadataurls = metadataurl;
        }

        if (typeof inlinemetadata === 'object' && inlinemetadata) {
            this.data = inlinemetadata;
        }


        this.parent.Utils.log('metadataurl is ' + metadataurl);
        if (!metadataurl)
            return;

        // If SP EntityID is set in configuration make sure it is sent as a parameter
        // to the feed endpoint.
        var discosettings = this.parent.Utils.options.get('disco');
        if (this.parent.Utils.options.get('discoSetRequestor', false)) {
            parameters.entityID = discosettings.spentityid;
        }

        that.parent.Utils.log('Setting up load() waiter');
        waiter = DiscoJuice.Utils.waiter(function () {
            that.parent.Utils.log('load() waiter EXECUTED');
            that.postLoad();
        }, 10000);

        for (i = 0; i < metadataurls.length; i++) {
            curmdurl = metadataurls[i];
            waiter.runAction(
                    function (notifyCompleted) {
                        console.log('control.completed()?');
                        var j = i + 1;
                        var req = $.ajax({
                            url: curmdurl,
                            dataType: 'json', //changed from jsonp
                            jsonpCallback: function () {
                                return 'dj_md_' + j;
                            },
                            cache: true,
                            data: parameters
                        });

                        req.done(function (data) {
                            that.customData = data.custom;

                            that.data = $.merge(that.data, data.discojuice);
                            that.parent.Utils.log('Successfully loaded metadata (' + data.length + ') (' + j + ' of ' + metadataurls.length + ')');
                            notifyCompleted();
                        });

                        req.fail(function (jqXHR, textStatus) {
                            console.log("Request failed: " + textStatus);
                        });
                    },
                    // Callback function that will be executed if action completed after timeout.
                    function () {
                        var c = curmdurl;
                        return function () {
                            that.ui.error("Metadata retrieval from [" + c + "] to slow. Ignoring response.");
                        }
                    }()
            );
        }

        waiter.startTimer();
    },
    
    "postLoad": function () {
        var that = this,
                waiter;

        if (!this.data) {
            return;
        }

        // Iterate through entities, and update title from DisplayNames to support Shibboleth integration.
        for (i = 0; i < this.data.length; i++) {
            if (!this.data[i].title) {
                if (this.data[i].DisplayNames) {
                    this.data[i].title = this.data[i].DisplayNames[0].value;
                }
            }
        }

        if (that.parent.Utils.options.get('country', false)) {
            that.filterCountrySetup();
        }
        /*
        function compare(a,b) {
            if (a.title < b.title)
              return -1;
            if (a.title > b.title)
              return 1;
            return 0;
          }

          this.data.sort(compare);
          console.log("Sorted entity ids")
*/
        that.readCookie(); // Syncronous
        that.readExtensionResponse(); // Reading response set by the Browser extension

        that.parent.Utils.log('Setting up postLoad() waiter');

        waiter = DiscoJuice.Utils.waiter(function () {
            that.prepareData();
            that.searchboxSetup();
            that.parent.Utils.log('postLoad() waiter EXECUTE');
        }, 2000);

        waiter.allowMultiple = true;

        that.discoReadSetup(waiter);
        that.discoSubReadSetup(waiter);
        that.getCountry(waiter);

        waiter.startTimer();
    },
    
    "readCookie": function () {
        if (this.parent.Utils.options.get('cookie', false)) {
            var selectedRelID = this.parent.Utils.readCookie();

            var entityID = selectedRelID;
            var subID = undefined;
            if (selectedRelID && selectedRelID.match(/^.*#.+?$/)) {
                var matched = /^(.*)#(.+?)$/.exec(selectedRelID);
                entityID = matched[1];
                subID = matched[2];
            }

            this.parent.Utils.log('COOKIE read ' + selectedRelID);
            if (selectedRelID) {
                this.setWeight(-100, entityID, subID);
                this.cookieEntityId = entityID;
            }
        }
    },
    
    /*
     * Reading response set by the Browser extension
     */
    "readExtensionResponse": function () {
        if (!this.extensionResponse)
            return;

        if (!!this.extensionResponse.autologin) {
            this.selectProvider(this.extensionResponse.entityID, this.extensionResponse.subID);
        }

        if (this.extensionResponse.selectedRelID) {
            this.setWeight(-100, this.extensionResponse.entityID, this.extensionResponse.subID);
        }
        this.parent.Utils.log('DiscoJuice Extension readExtensionResponse ' + this.extensionResponse.entityID + ' ' + this.extensionResponse.subID);
    },
    
    "discojuiceextension": function () {
        var selectedRelID = $("meta#discojuiceextension_id").attr('content');
        if (!selectedRelID)
            return;

        var entityID = selectedRelID;
        var subID = undefined;
        if (selectedRelID && selectedRelID.match(/^.*#.+?$/)) {
            var matched = /^(.*)#(.+?)$/.exec(selectedRelID);
            entityID = matched[1];
            subID = matched[2];
        }

        this.parent.Utils.log('DiscoJuice Extension read ' + selectedRelID + ' ' + entityID + ' ' + subID);

        var autologin = $("meta#discojuice_autologin").attr('content');

        this.extensionResponse = {
            selectedRelID: selectedRelID,
            entityID: entityID,
            subID: subID,
            autologin: autologin
        };
    },
  
    /*
     * Set weight to a specific data entry.
     */
    "setWeight": function (weight, entityID, subID) {
        for (i = 0; i < this.data.length; i++) {
            if (this.data[i].entityID !== entityID)
                continue;
            if (subID && !this.data[i].subID)
                continue;
            if (subID && subID !== this.data[i].subID)
                continue;
            if (this.data[i].subID && !subID)
                continue;

            if (isNaN(this.data[i].weight))
                this.data[i].weight = 0;
            this.data[i].weight += weight;
            this.parent.Utils.log('COOKIE Setting weight to ' + this.data[i].weight);
            return;
        }
        this.parent.Utils.log('DiscoJuice setWeight failer (no entries found for) ' + entityID + ' # ' + subID);
    },
    
    "discoResponseError": function (cid, error) {
        this.parent.Utils.log('DiscoResponse ERROR Received cid=' + cid);
        if (cid) {
            this.runCallback(cid);
        }

        if (error) {
            this.ui.error(error);
        }
    },
    
    "discoResponse": function (sender, entityID, subID, cid) {
        this.parent.Utils.log('DiscoResponse Received from [' + sender + '] entityID: ' + entityID + ' subID: ' + subID);

        var includessubid = true;
        var settings = this.parent.Utils.options.get('disco');
        if (settings) {
            var stores = settings.subIDstores;
            if (stores) {
                if (stores[entityID] && !subID) {
                    this.parent.Utils.log('Ignoring discoResponse from entityID: ' + entityID + ' because subID was required and not provided');
                    includessubid = false;
                }
            }
        }

        if (includessubid) {
            this.setWeight(-100, entityID, subID);
        }


        if (cid) {
            this.runCallback(cid);
        } else {
            // Fallback; if response endpoint is not yet updated to support passing a callback ID reference.
            this.prepareData();
        }
    },
    
    "calculateDistance": function (update) {
        var targets, distances;
        for (var i = 0; i < this.data.length; i++) {
            if (this.data[i].geo) {
                targets = [];
                distances = [];

                // Support multiple geo coordinates. Make targets be an array of targets.
                if (typeof (this.data[i].geo) === 'object' && (this.data[i].geo instanceof Array)) {
                    targets = this.data[i].geo;
                } else {
                    targets.push(this.data[i].geo);
                }

                // Iterate through all targets, and stuff the distances in to 'distances'.
                for (var j = 0; j < targets.length; j++) {
                    distances.push(
                        this.parent.Utils.calculateDistance(targets[j].lat, targets[j].lon, this.location[0], this.location[1])
                    );
                }
                this.data[i].distance = Math.min.apply(Math, distances);

                this.data[i].distanceweight = (2 * Math.log(this.data[i].distance + 1)) - 10;

            }
        }

        this.showdistance = true;
        if (update) {
            this.prepareData();
        }
    },
    
    "locateMe": function () {
        var that = this;
        this.parent.Utils.log('Locate Me');

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                    function (position) {

                        // Did we get the position correctly?
                        // alert (position.coords.latitude);

                        // To see everything available in the position.coords array:
                        // for (key in position.coords) {alert(key)}

                        //console.log('You are here: lat ' + position.coords.latitude + ' lon ' + position.coords.longitude);

                        that.ui.setLocationText('You are here: ' + position.coords.latitude + ', ' + position.coords.longitude + '. Nearby providers shown on top.');

                        that.location = [position.coords.latitude, position.coords.longitude];
                        that.calculateDistance(true);

                    },
                    // next function is the error callback
                            function (error) {
                                switch (error.code) {
                                    case error.TIMEOUT:
                                        that.ui.setLocationText('Timeout');
                                        break;
                                    case error.POSITION_UNAVAILABLE:
                                        that.ui.setLocationText('Position unavailable');
                                        break;
                                    case error.PERMISSION_DENIED:
                                        that.ui.setLocationText('Permission denied');
                                        break;
                                    case error.UNKNOWN_ERROR:
                                        that.ui.setLocationText('Unknown error');
                                        break;
                                }
                            }
                    );
                } else {
            this.parent.Utils.log('Did not find navigator.geolocation');
        }

    },
    
    "increase": function () {
        this.maxhits += this.hitIncrease;//100;
        this.prepareData();

    },
    
    "isEnabled": function (item) {
        var relID = item.entityID;
        if (item.subID) {
            relID += '#' + item.subID;
        }

        if (this.subsetEnabled === null)
            return true;
        if (this.subsetEnabled[relID])
            return true;
        if (this.subsetEnabled[item.entityID])
            return true;

        return false;
    },
    
    "prepareData": function (showall) {
        var showall = (showall ? true : false);

        this.parent.Utils.log('DiscoJuice.Control prepareData(). data.length=' + this.data.length);

        var hits, i, current, search;
        var someleft = false;

        var term = this.getTerm();
        var categories = this.getCategories();

        if (!this.data)
            return;

        var sorted = [];
        var dataWithWeight = [];
        var dataWithoutWeight = [];
        var langs = [];
        if(this.customData.languages !== null) {
            langs = this.customData.languages;
        }
        
        this.data.forEach(function(i) {
            setTitle(i, langs);
            if(i.weight !== 0 || (i.distanceweight && i.distanceweight !== 0) ) {
                dataWithWeight.push(i);
            } else {
                dataWithoutWeight.push(i);
            }
        });
        
        dataWithWeight
            .sort(function (a, b) {
                var xa, xb;
                xa = (a.weight ? a.weight : 0);
                xb = (b.weight ? b.weight : 0);
                if (a.distanceweight)
                    xa += a.distanceweight;
                if (b.distanceweight)
                    xb += b.distanceweight;
                return (xa - xb);
            })
            .forEach(function(d) {
                sorted.push(d);
            });
        dataWithoutWeight
            .sort(function (a, b) {
               if(a.title === null) {
                   return -1;
               }
               return a.title.localeCompare(b.title);
            })
            .forEach(function(d) {
                sorted.push(d);
            });
        
        this.data = sorted;

        if (term || categories) {
            this.ui.popup.find("p.discojuice_showall").show();
        } else {
            this.ui.popup.find("p.discojuice_showall").hide();
        }

        this.ui.clearItems();

        this.quickEntry = null;
        var quickSelected = false;

        var preselectedIDP = this.parent.Utils.options.get('preselected');

        //TODO optimize the following two loops, code duplicated

        //search and set preselected item
        for (i = 0; i < this.data.length; i++) {
            current = this.data[i];
            setTitle(current, this.customData.languages);

            if (preselectedIDP !== undefined && current.entityID === preselectedIDP) {
                if (!current.weight)
                    current.weight = 0;

                if (!current.title) {
                    this.parent.Utils.log('No title for this entry [' + current.entityID + (current.relID) + '] skipping.');
                    continue;
                }

                if (categories && categories.country) {
                    if (!current.country)
                        continue;
                    if (current.country !== '_all_' && categories.country !== current.country && current.weight > -50)
                        continue;
                }

                var countrydef = null;
                if (current.country) {
                    var cname = (this.parent.Constants.Countries[current.country] ? this.parent.Constants.Countries[current.country] : current.country);
                    if (cname !== '_all_') {
                        var cflag = (this.parent.Constants.Flags[current.country] ? this.parent.Constants.Flags[current.country] : undefined);
                        countrydef = {'country': cname, 'flag': cflag};
                    }
                }

                var enabled = this.isEnabled(current);

                /*
                 * Quick selection is the entry that you can go to by just hitting enter.
                 */
                var quickSel = false;
                if (!quickSelected) {
                    //console.log('Term: ' + term);
                    //console.log('Search: ' + search);
                    if (this.cookieEntityId == current.entityID) {
                        quickSel = true;
                        quickSelected = true;
                    } else if (term && search !== false) {
                        quickSel = true;
                        quickSelected = true;
                    } else if (!term && !this.cookieEntityId) {
                        quickSel = true;
                        quickSelected = true;
                    }
                }

                //add to preselect list
                this.ui.addPreselectedItem(current, countrydef, search, current.distance, quickSel, enabled);

                if (quickSel) {
                    this.quickEntry = current;
                }
            }
        }

        //quickselect
        /*
         * Quick selection is the entry that you can go to by just hitting enter.
         */
        if (!quickSelected) {
            for (i = 0; i < this.data.length; i++) {
                current = this.data[i];            

               if (this.cookieEntityId === current.entityID) {

                    setTitle(current, this.customData.languages);

                    if (!(preselectedIDP !== undefined && current.entityID === preselectedIDP)) {
                        if (!current.weight)
                            current.weight = 0;

                        if (!current.title) {
                            this.parent.Utils.log('No title for this entry [' + current.entityID + (current.relID) + '] skipping.');
                            continue;
                        }

                        if (term) {
                            search = this.parent.Utils.searchMatch(current, term);
                            if (search === false)
                                continue;
                        } else {
                            search = null;
                        }

                        if (categories && categories.country) {
                            if (!current.country)
                                continue;
                            if (current.country !== '_all_' && categories.country !== current.country && current.weight > -50)
                                continue;
                        }

                        var countrydef = null;
                        if (current.country) {
                            var cname = (this.parent.Constants.Countries[current.country] ? this.parent.Constants.Countries[current.country] : current.country);
                            if (cname !== '_all_') {
                                var cflag = (this.parent.Constants.Flags[current.country] ? this.parent.Constants.Flags[current.country] : undefined);
                                countrydef = {'country': cname, 'flag': cflag};
                            }
                        }

                    }
                    
                    var enabled = this.isEnabled(current);
                    this.ui.addItem(current, countrydef, search, current.distance, true, enabled);
                    console.log("Added quick select IDP ["+current.entityID+"]");
                    
                    this.quickEntry = current;                    
                    break;                
                }
            }
        }
        
        hits = 0;
        for (i = 0; i < this.data.length; i++) {
            current = this.data[i];
            if(!this.quickEntry || this.quickEntry.entityID !== current.entityID) {
                setTitle(current, this.customData.languages);

                if (!(preselectedIDP !== undefined && current.entityID === preselectedIDP)) {
                    if (!current.weight)
                        current.weight = 0;

                    if (!current.title) {
                        this.parent.Utils.log('No title for this entry [' + current.entityID + (current.relID) + '] skipping.');
                        continue;
                    }

                    if (term) {
                        search = this.parent.Utils.searchMatch(current, term);
                        if (search === false)
                            continue;
                    } else {
                        search = null;
                    }

                    if (categories && categories.country) {
                        if (!current.country)
                            continue;
                        if (current.country !== '_all_' && categories.country !== current.country && current.weight > -50)
                            continue;
                    }

                    var countrydef = null;
                    if (current.country) {
                        var cname = (this.parent.Constants.Countries[current.country] ? this.parent.Constants.Countries[current.country] : current.country);
                        if (cname !== '_all_') {
                            var cflag = (this.parent.Constants.Flags[current.country] ? this.parent.Constants.Flags[current.country] : undefined);
                            countrydef = {'country': cname, 'flag': cflag};
                        }
                    }

                    if (++hits > this.maxhits) {
                        someleft = true;
                        break;
                    }

                    var enabled = this.isEnabled(current);
                    this.ui.addItem(current, countrydef, search, current.distance, false, enabled);
                }
            }
        }

        this.ui.refreshData(someleft, this.maxhits, hits);

        /**
         * Set the title in the IDP object based on the language preference
         * infered from the Accept-Language headers included in the customData
         * section
         */
        function setTitle(idp, languagePreference) {
            var preferedTitle = null;
            
            //Try to select a title in one of the prefered languages
            for(var i = 0; i < languagePreference.length; i++) {
                var lang = languagePreference[i];
                preferedTitle = getTitleForLanguage(lang);
                if(preferedTitle !== null) {
                    break;
                }
            }
            
            //If the title is not available in any of the prefered languages, fallback
            //to english as the default (Assuming we always have an english entry!)
            if(preferedTitle === null) {
                preferedTitle = getTitleForLanguage('en');
            }
            
            idp.title = preferedTitle;

            function getTitleForLanguage(lang) {
                for (var i = 0; i < idp.titles.length; i++) {
                    var t = idp.titles[i];
                    if (t.language === lang) {
                        return t.value.trim();
                    }
                }
                //Return first entry if we couldn't match any prefered langauge
                if (idp.titles.length > 0) {
                    return idp.titles[0].value.trim();
                }
                return null;
            }
        }
   },
   
    "hitEnter": function () {
        this.parent.Utils.log("hitEnter() " + this.quickEntry);
        this.selectProvider(this.quickEntry.entityID, this.quickEntry.subID);
    },
    
    "selectProvider": function (entityID, subID) {
        var callback;
        var that = this;
        var entity = null;

        callback = this.parent.Utils.options.get('callback');

        for (i = 0; i < this.data.length; i++) {
            if (this.data[i].entityID == entityID) {
                if (!subID || subID == this.data[i].subID) {
                    entity = this.data[i];
                }
            }
        }

        if (entity.auth && entity.auth === 'local') {
            this.parent.Utils.log('local');
            callback(entity, that);
            return;
        }
        
        var mustwait = that.discoWrite(entityID, subID);

        if (this.parent.Utils.options.get('cookie', false)) {
            var relID = entityID;
            if (subID)
                relID += '#' + subID;

            this.parent.Utils.log('COOKIE write ' + relID);
            this.parent.Utils.createCookie(relID);
        }

        this.parent.Utils.log('Entity Selected');
        this.parent.Utils.log(entity);

        if (callback) {
            if (mustwait) {
                $.doTimeout(1000, function () {
                    callback(entity, that);
                });

            } else {
                callback(entity, that);
            }
            return;
        }

    },
    
    // Setup an iframe to read discovery cookies from other domains
    "discoReadSetup": function (waiter) {
        var that = this;
        var settings = this.parent.Utils.options.get('disco');

        if (!settings)
            return;

        var html = '';
        var returnurl = settings.url;
        var spentityid = settings.spentityid;
        var stores = settings.stores;
        var i;
        var currentStore;
        var callbackid;
        var returnurlwithparams;

        if (!stores)
            return;

        for (i = 0; i < stores.length; i++) {
            waiter.runAction(function (notifyCompleted) {
                callbackid = that.registerCallback(notifyCompleted);
                returnurlwithparams = DiscoJuice.Utils.addQueryParam(returnurl, 'cid', callbackid);

                currentStore = stores[i];
                that.parent.Utils.log('Setting up DisoJuice Read from Store [' + currentStore + ']');
                iframeurl = currentStore + '?entityID=' + escape(spentityid) + '&isPassive=true&returnIDParam=entityID&return=' + escape(returnurlwithparams);
                html = '<iframe src="' + iframeurl + '" style="display: none"></iframe>';
                that.ui.addContent(html);
            });
        }
    },
    
    // Setup an iframe to read discovery cookies from other domains
    "discoSubReadSetup": function (waiter) {
        var settings = this.parent.Utils.options.get('disco');
        var that = this;

        this.parent.Utils.log('discoSubReadSetup()');

        if (!settings)
            return;

        var html = '';
        var returnurl = settings.url;
        var spentityid = settings.spentityid;
        var stores = settings.subIDstores;
        var i;
        var currentStore;
        var callbackid;

        if (!stores)
            return;

        for (var idp in stores) {
            this.parent.Utils.log('discoSubReadSetup()');

            waiter.runAction(function (notifyCompleted) {

                callbackid = that.registerCallback(notifyCompleted);
                returnurl = settings.url + '?entityID=' + escape(idp) + '&cid=' + callbackid;

                currentStore = stores[idp];
                that.parent.Utils.log('Setting up SubID DisoJuice Read from Store [' + idp + '] =>  [' + currentStore + ']');
                iframeurl = currentStore + '?entityID=' + escape(spentityid) + '&isPassive=true&returnIDParam=subID&return=' + escape(returnurl);
                that.parent.Utils.log('iFrame URL is  [' + iframeurl + ']');
                that.parent.Utils.log('return URL is  [' + returnurl + ']');
                html = '<iframe src="' + iframeurl + '" style="display: none"></iframe>';
                that.ui.addContent(html);
            });
        }
    },
    
    "discoWrite": function (entityID, subID) {
        var settings = this.parent.Utils.options.get('disco');
        if (!settings)
            return false;
        if (!settings.writableStore)
            return false;

        var html = '';
        var returnurl = settings.url;
        var spentityid = settings.spentityid;
        var writableStore = settings.writableStore;

        var idpentityid = entityID;

        this.parent.Utils.log('DiscoJuice.Control discoWrite()');

        if (subID) {
            this.parent.Utils.log('DiscoJuice.Control discoWrite(...)');
            if (settings.subIDwritableStores && settings.subIDwritableStores[entityID]) {

                this.parent.Utils.log('DiscoJuice.Control discoWrite(' + entityID + ') with SubID [' + subID + ']');
                writableStore = settings.subIDwritableStores[entityID];
                iframeurl = settings.subIDwritableStores[entityID] + escape(subID);

                this.parent.Utils.log('DiscoJuice.Control discoWrite iframeURL (' + iframeurl + ') ');

                html = '<iframe src="' + iframeurl + '" style="display: none"></iframe>';
                this.ui.addContent(html);
                return true;
            }
            idpentityid += "#" + subID;
        }

        this.parent.Utils.log('DiscoJuice.Control discoWrite(' + idpentityid + ') to ' + writableStore);

        iframeurl = DiscoJuice.Utils.addQueryParam(writableStore, 'origin', spentityid);
        iframeurl = DiscoJuice.Utils.addQueryParam(iframeurl, 'IdPentityID', idpentityid);
        iframeurl = DiscoJuice.Utils.addQueryParam(iframeurl, 'isPassive', 'true');
        iframeurl = DiscoJuice.Utils.addQueryParam(iframeurl, 'returnIDParam', 'bogus');
        iframeurl = DiscoJuice.Utils.addQueryParam(iframeurl, 'return', returnurl);

        this.parent.Utils.log('DiscoJuice.Control discoWrite iframeURL (2)(' + iframeurl + ') ');

        html = '<iframe src="' + iframeurl + '" style="display: none"></iframe>';
        this.ui.addContent(html);
        return true;
    },
    
    "searchboxSetup": function () {
        var that = this;
        /*
         Initialise the search box.
         */

        var waiter = function (setCallback) {
            var my = {};

            // Number of milliseconds to wait for more events.
            my.delay = 400;
            my.counter = 0;

            // Call back to fire, when the waiter is pinged, and waited for the timeout 
            // (without subsequent events).
            my.callback = setCallback;

            // Ping
            function ping(event) {
                my.counter++;
                setTimeout(function () {
                    if (--my.counter === 0) {
                        my.callback(event);
                    }
                }, my.delay);
            }

            my.ping = ping;
            return my;
        }

        var performSearch = waiter(function (event) {
            term = that.ui.popup.find("input.discojuice_search").val();

            // Will not perform a search when search term is only one character..
            if (term.length === 1) {
                return;
            }
            that.prepareData();
        });

        this.ui.popup.find("input.discojuice_search").keydown(function (event) {
            var charCode, term;

            if (event && event.which) {
                charCode = event.which;
            } else if (window.event) {
                event = window.event;
                charCode = event.keyCode;
            }

            if (charCode == 13) {
                that.hitEnter();
                return;
            }
            if (charCode == 27) {
                that.ui.hide();
                return;
            }

            performSearch.ping(event);
        });
        this.ui.popup.find("input.discojuice_search").change(function (event) {
            performSearch.ping(event);
        });
        this.ui.popup.find("input.discojuice_search").mousedown(function (event) {
            performSearch.ping(event);
        });
    },
    
    "filterCountrySetup": function (choice) {
        var that = this;
        var key;

        this.parent.Utils.log('filterCountrySetup()');

        // Reduce country list to those in metadata
        var validCountry = {};
        for (key in this.data) {
            if (this.data[key].country && this.data[key].country !== '_all_') {
                validCountry[this.data[key].country] = true;
            }
        }

        var countries = 0;
        for (key in validCountry) {
            countries++;
        }

        var preset = this.parent.Utils.options.get('setCountry');
        if (!choice && preset) {
            if (filterOptions[preset])
                choice = preset;
        }

        var ftext = '<p class="discojuice_filter_country">' + DiscoJuice.Dict.showIn + ' ' +
                '<select class="discojuice_filterCountrySelect" name="filterCountrySelect">';

        if (choice) {
            ftext += '<option value="all">' + DiscoJuice.Dict.allCountries + '</option>';
        } else {
            ftext += '<option value="all" selected="selected">' + DiscoJuice.Dict.allCountries + '</option>';
        }

        for (key in this.parent.Constants.Countries) {
            if (key === choice) {
                ftext += '<option value="' + key + '" selected="selected">' + this.parent.Constants.Countries[key] + '</option>';
            } else if (validCountry[key]) {
                ftext += '<option value="' + key + '" >' + this.parent.Constants.Countries[key] + '</option>';
            }
        }
        ftext += '</select>';
        //ftext += ' <a class="discojuice_showall textlink" href="">' + DiscoJuice.Dict.showAllCountries+ '</a>';
        ftext += '</p>';

        this.ui.addFilter(ftext).find("select").change(function (event) {
            event.preventDefault();
            that.resetTerm();
            that.ui.focusSearch();
            if (that.ui.popup.find("select.discojuice_filterCountrySelect").val() !== 'all') {
                that.ui.popup.find("a.discojuice_showall").show();
            } else {
                that.ui.popup.find("a.discojuice_showall").hide();
            }
            that.prepareData();
        });
        this.ui.popup.find("a.discojuice_showall").click(function (event) {
            event.preventDefault();
            that.resetCategories();
            that.resetTerm();
            that.prepareData(true);
            that.ui.focusSearch();
            that.ui.popup.find("a.discojuice_showall").hide();
        });
    },
    
    "setCountry": function (country, update) {
        if (this.parent.Constants.Countries[country]) {
            this.ui.popup.find('select.discojuice_filterCountrySelect').val(country);
            if (update) {
                this.prepareData();
            }
        }
    },
    
    "setPosition": function (lat, lon, update) {
        this.location = [lat, lon];
        this.calculateDistance(update);
    },
    
    "getCountry": function (waiter) {
        // If countryAPI is set, then lookup by IP.
        var countryapi = this.parent.Utils.options.get('countryAPI', false);
        var that = this;

        if (countryapi) {
            var countrycache = this.parent.Utils.readCookie('Country2');
            var geocachelat = parseFloat(this.parent.Utils.readCookie('GeoLat'));
            var geocachelon = parseFloat(this.parent.Utils.readCookie('GeoLon'));

            if (countrycache) {

                this.setCountry(countrycache, false);
                this.parent.Utils.log('DiscoJuice getCountry() : Found country in cache: ' + countrycache);

                if (geocachelat && geocachelon) {
                    this.setPosition(geocachelat, geocachelon, false);
                }

            } else {
                waiter.runAction(
                        function (notifyCompleted) {

                            $.ajax({
                                cache: true,
                                url: countryapi,
                                dataType: 'jsonp',
                                jsonpCallback: function () {
                                    return 'dj_country';
                                },
                                success: function (data) {
                                    if (data && data.status == 'ok' && data.country) {

                                        that.parent.Utils.createCookie(data.country, 'Country2');
                                        that.setCountry(data.country, false);
                                        that.parent.Utils.log('DiscoJuice getCountry() : Country lookup succeeded: ' + data.country);

                                        if (data.geo && data.geo.lat && data.geo.lon) {
                                            that.setPosition(data.geo.lat, data.geo.lon, false);
                                            that.parent.Utils.createCookie(data.geo.lat, 'GeoLat');
                                            that.parent.Utils.createCookie(data.geo.lon, 'GeoLon');
                                        }

                                    } else if (data && data.error) {
                                        that.parent.Utils.log('DiscoJuice getCountry() : Country lookup failed: ' + (data.error || ''));
                                        that.ui.error("Error looking up users localization by country: " + (data.error || ''));
                                    } else {
                                        that.parent.Utils.log('DiscoJuice getCountry() : Country lookup failed');
                                        that.ui.error("Error looking up users localization by country.");
                                    }
                                    notifyCompleted();
                                }
                            });
                        }
                );
            }
        }
    },
    
    "resetCategories": function () {
        this.ui.popup.find("select.discojuice_filterCountrySelect").val('all');
    },
   
    "getCategories": function () {
        var filters = {};
        var type, country;

        type = this.ui.popup.find("select.discojuice_filterTypeSelect").val();
        if (type && type !== 'all') {
            filters.type = type;
        }

        country = this.ui.popup.find("select.discojuice_filterCountrySelect").val();
        if (country && country !== 'all') {
            filters.country = country;
        }

        return filters;
    },
    
    "getTerm": function () {
        return this.ui.popup.find("input.discojuice_search").val();
    },
    
    "resetTerm": function () {
        this.ui.popup.find("input.discojuice_search").val('');
    }
};