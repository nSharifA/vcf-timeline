/*-
 * #%L
 * Timeline
 * %%
 * Copyright (C) 2021 - 2026 Vaadin Ltd
 * %%
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * 
 *      http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * #L%
 */
import Arrow from './arrow.js';
import moment from 'moment';

import { DataSet, Timeline, moment as visMoment } from 'vis-timeline/standalone/umd/vis-timeline-graph2d.min.js';

// Locales already reported as unlocalizable (see the locale block in
// _processOptions). Warn once per locale: with many timelines on a page each
// setOptions call would otherwise repeat the same warning.
var _missingLocaleWarned = {};

// Build a moment.js locale from Intl/CLDR data for languages neither bundled
// moment copy has data for (see the locale block in _processOptions). Only
// what vis-timeline reads off localeData() is generated — month/weekday
// names, the L*/LT* date patterns and the week start; the rest of the locale
// inherits moment's English defaults. Throws for language tags Intl rejects;
// dayPeriod values (AM/PM) stay approximate as moment can't take them from
// Intl without per-locale data.
function _defineLocaleFromIntl(m, locale) {
  var year = 2021;

  function names(opts, dates) {
    var fmt = new Intl.DateTimeFormat(locale, opts);
    return dates.map(function (d) {
      var out = '';
      fmt.formatToParts(d).forEach(function (p) {
        if (p.type === 'month' || p.type === 'weekday') {
          out += p.value;
        }
      });
      // CLDR short forms carry their own trailing dot ("nov.", "pe."); the
      // converted patterns emit that dot as a literal, so keep it out of the
      // arrays or it would render twice.
      return out.replace(/\.+$/, '');
    });
  }

  // Convert an Intl date format into the equivalent moment format string,
  // keeping each part's order and stuck-on punctuation on its real side
  // ("5." becomes "D[.]", "nov." becomes "MMM[.]", ".nov." the prefix form).
  // Month/weekday width isn't visible in the parts, so it is inferred from
  // the name's length \u2014 good enough for the formats vis actually uses.
  // Case-inflected CLDR forms (Finnish "marraskuuta") collapse to the
  // nominative arrays moment's MMMM token reads.
  function pattern(opts) {
    var d = new Date(year, 10, 5, 9, 8, 7); // a Friday
    var out = '';
    try {
      new Intl.DateTimeFormat(locale, opts).formatToParts(d).forEach(function (p) {
        if (p.type === 'literal' || p.type === 'era' || p.type === 'timeZoneName') {
          out += '[' + p.value + ']';
          return;
        }
        var run = /\d+/.exec(p.value) || /[A-Za-z\u00AA-\uFFFF]+/.exec(p.value);
        if (!run) {
          out += '[' + p.value + ']';
          return;
        }
        var pre = p.value.slice(0, run.index);
        var post = p.value.slice(run.index + run[0].length);
        var numeric = /\d/.test(run[0]);
        var token;
        if (p.type === 'year') { token = run[0].length === 2 ? 'YY' : 'YYYY'; }
        else if (p.type === 'month') { token = numeric ? (run[0].length > 1 ? 'MM' : 'M') : (run[0].length <= 4 ? 'MMM' : 'MMMM'); }
        else if (p.type === 'day') { token = numeric && run[0].length > 1 ? 'DD' : 'D'; }
        else if (p.type === 'weekday') { token = run[0].length <= 2 ? 'ddd' : 'dddd'; }
        else if (p.type === 'hour') { token = run[0].length > 1 ? 'HH' : 'H'; }
        else if (p.type === 'minute') { token = 'mm'; }
        else if (p.type === 'second') { token = 'ss'; }
        else if (p.type === 'dayPeriod') { token = 'a'; }
        else { token = '[' + p.value + ']'; }
        out += (pre ? '[' + pre + ']' : '') + token + (post ? '[' + post + ']' : '');
      });
    } catch (e) {
      return undefined; // engine without dateStyle/timeStyle support
    }
    return out;
  }

  var monthDates = [], weekdayDates = [];
  for (var mo = 0; mo < 12; mo++) { monthDates.push(new Date(year, mo, 15)); }
  for (var wd = 0; wd < 7; wd++) { weekdayDates.push(new Date(year, 0, 3 + wd)); } // Jan 3 2021 is a Sunday

  var week = { dow: 0, doy: 4 };
  try {
    var wi = new Intl.Locale(locale).weekInfo;
    if (wi && wi.firstDay) { week = { dow: wi.firstDay % 7, doy: wi.minimalDays }; }
  } catch (e) {
  }

  var defined = m.defineLocale(locale, {
    months: names({ month: 'long' }, monthDates),
    monthsShort: names({ month: 'short' }, monthDates),
    weekdays: names({ weekday: 'long' }, weekdayDates),
    weekdaysShort: names({ weekday: 'short' }, weekdayDates),
    weekdaysMin: names({ weekday: 'narrow' }, weekdayDates),
    longDateFormat: {
      LT: pattern({ timeStyle: 'short' }),
      LTS: pattern({ timeStyle: 'medium' }),
      L: pattern({ dateStyle: 'short' }),
      LL: pattern({ dateStyle: 'medium' }),
      LLL: pattern({ dateStyle: 'medium', timeStyle: 'short' }),
      LLLL: pattern({ dateStyle: 'full', timeStyle: 'short' })
    },
    week: week
  });
  if (!defined) {
    throw new Error('moment rejected the synthesized "' + locale + '" locale');
  }
}

window.vcftimeline = {

	create: function(container, itemsJson, groupsJson, optionsJson) {
        setTimeout(() => this._createTimeline(container, itemsJson, groupsJson, optionsJson));
    },

	_createTimeline: function(container, itemsJson, groupsJson, optionsJson) {
	  // parsed items
	  var parsedItems = JSON.parse(itemsJson);

	  // Create a DataSet
	  var items = new DataSet(parsedItems);

	  // Create a DataSet for the groups. A setGroups() call queued in the same
	  // round trip runs before this deferred constructor, so a stashed value
	  // (never applied to a timeline yet) takes precedence over groupsJson.
	  // Note: an EMPTY groups DataSet must not be passed to the constructor —
	  // any groups object (even empty) switches vis-timeline into grouped mode,
	  // where items without a group reference are never placed, i.e. every
	  // item of an ungrouped timeline would disappear.
	  var groups;
	  if (container.pendingGroupsDataSet !== undefined) {
		groups = container.pendingGroupsDataSet;
		container.pendingGroupsDataSet = null;
	  } else {
		groups = new DataSet(groupsJson ? JSON.parse(groupsJson) : []);
	  }
	  if (groups == null) {
		groups = new DataSet([]);
	  }
	  container.groupsDataSet = groups;

	  // Get options for timeline configuration
	  var options = this._processOptions(container, optionsJson);

	  // Create Timeline (groups is the 3rd constructor argument, before
	  // options; omitted entirely when there are no groups)
	  var timeline = groups.getIds().length > 0
			? new Timeline(container, items, groups, options)
			: new Timeline(container, items, options);
      		
      const line_timeline = new Arrow(timeline);
	  container.timeline = line_timeline;

	  container.timeline._timeline.on("changed", () => {
		if (container.arrowsEnabled !== false) {
		  this._updateConnections(container);
		}
		this._updateTimelineHeight(container);
		this._restackInitialGroupRows(container);
	  });

	  container.timeline._timeline.on('select', (properties) => {
		container.$server.onSelect(properties.items);
	  });

	  var mouseX;
	  container.timeline._timeline.on('mouseMove', (properties) => {
		mouseX = properties.event.clientX;
	  });

	  // Replay server calls that arrived during the deferred constructor
	  this._flushPendingCalls(container);

	  setInterval(function(){
		var isDragging = container.timeline._timeline.itemSet.touchParams.itemIsDragging;
		var isResizingRight = container.timeline._timeline.itemSet.touchParams.dragRightItem;
		var isResizingLeft = container.timeline._timeline.itemSet.touchParams.dragLeftItem;
		var isResizing = isResizingRight !== isResizingLeft;
		if (isDragging) {
			let multiple = container.timeline._timeline.itemSet.touchParams.itemProps.length > 1;
			let itemsInitialXMap = null;
			let selectedItems = null;
			if(multiple) {
				itemsInitialXMap = new Map();
				container.timeline._timeline.itemSet.touchParams.itemProps.forEach(obj => {
					itemsInitialXMap.set(obj.data.id, obj.initialX);
				});
				selectedItems = Array.from(container.timeline._timeline.itemSet.touchParams.itemProps, obj => obj.item);
			} 

			var ix = container.timeline._timeline.itemSet.touchParams.itemProps[0].initialX; 
			var item = container.timeline._timeline.itemSet.touchParams.selectedItem;
			var range = container.timeline._timeline.getWindow();
			var widthInPixels = container.timeline._timeline.body.domProps.lastWidth;
			var centerOfTimelineInPixels = container.timeline._timeline.dom.container.offsetLeft + container.timeline._timeline.body.domProps.lastWidth / 2;
			var mouseAtLeftOfCenter = mouseX < centerOfTimelineInPixels;
			var widthInMilliseconds = range.end.valueOf() - range.start.valueOf();

			// handle autoscrolling when moving, not resizing
			if(mouseAtLeftOfCenter && item.data.start <= range.start && (options.min == undefined || range.start > new Date(options.min)) && !isResizing) {
				window.vcftimeline._moveWindowToRight(container, range, widthInMilliseconds);
				if(multiple){					
					container.timeline._timeline.itemSet.touchParams.itemProps.forEach(ip => {
						let id = ip.data.id;
						let initialXValue = itemsInitialXMap.get(id);
						ip.initialX = initialXValue + (widthInPixels / 50);
					});
					selectedItems.forEach(selectedItem => {
						selectedItem.data.start = new Date(selectedItem.data.start.valueOf() - (widthInMilliseconds / 50));
						selectedItem.data.end = new Date(selectedItem.data.end.valueOf() - (widthInMilliseconds / 50));
					});
				} else {					
					container.timeline._timeline.itemSet.touchParams.itemProps[0].initialX = ix + (widthInPixels / 50);
					item.data.start = new Date(item.data.start.valueOf() - (widthInMilliseconds / 50));
					item.data.end = new Date(item.data.end.valueOf() - (widthInMilliseconds / 50));
				}

			} else if(!mouseAtLeftOfCenter && item.data.end >= range.end && (options.max == undefined || range.end < new Date(options.max)) && !isResizing) {
				window.vcftimeline._moveWindowToLeft(container, range, widthInMilliseconds);
				if(multiple){										
					container.timeline._timeline.itemSet.touchParams.itemProps.forEach(ip => {
						let id = ip.data.id;
						let initialXValue = itemsInitialXMap.get(id);
						ip.initialX = initialXValue - (widthInPixels / 50);
					});
					selectedItems.forEach(selectedItem => {
						selectedItem.data.start = new Date(selectedItem.data.start.valueOf() + (widthInMilliseconds / 50));
						selectedItem.data.end = new Date(selectedItem.data.end.valueOf() + (widthInMilliseconds / 50));
					});
				} else {					
					container.timeline._timeline.itemSet.touchParams.itemProps[0].initialX = ix - (widthInPixels / 50);
					item.data.start = new Date(item.data.start.valueOf() + (widthInMilliseconds / 50));
					item.data.end = new Date(item.data.end.valueOf() + (widthInMilliseconds / 50));
				}
			}

			// auto scroll to left when resizing left
			if(item.data.start <= range.start && (options.min == undefined || range.start > new Date(options.min)) && isResizingLeft) {
				window.vcftimeline._moveWindowToRight(container, range, widthInMilliseconds, widthInPixels, ix);
				item.data.start = new Date(item.data.start.valueOf() - (widthInMilliseconds / 50));
			}

			// auto scroll to right when resizing left
			if(item.data.start >= range.end && (options.max == undefined || range.end < new Date(options.max)) && isResizingLeft) {
				window.vcftimeline._moveWindowToLeft(container, range, widthInMilliseconds, widthInPixels, ix);
				item.data.start = new Date(item.data.start.valueOf() + (widthInMilliseconds / 50));
			}

			// auto scroll to right when resizing right
			if(item.data.end >= range.end && (options.max == undefined || range.end < new Date(options.max)) && isResizingRight) {
				window.vcftimeline._moveWindowToLeft(container, range, widthInMilliseconds, widthInPixels, ix);
				item.data.end = new Date(item.data.end.valueOf() + (widthInMilliseconds / 50));
			}

			// auto scroll to left when resizing right
			if(item.data.end <= range.start && (options.min == undefined || range.start > new Date(options.min)) && isResizingRight) {
				window.vcftimeline._moveWindowToRight(container, range, widthInMilliseconds, widthInPixels, ix);
				item.data.end = new Date(item.data.end.valueOf() - (widthInMilliseconds / 50));
			}
		}
	  }, 100);
  	},

	_moveWindowToRight(container, range, widthInMilliseconds) {
		container.timeline._timeline.setWindow(
			new Date(range.start.valueOf() - (widthInMilliseconds / 50)),
			new Date(range.end.valueOf() - (widthInMilliseconds / 50)),
			{animation: false}
		);
	},

	_moveWindowToLeft(container, range, widthInMilliseconds) {
		container.timeline._timeline.setWindow(
			new Date(range.start.valueOf() + (widthInMilliseconds / 50)),
			new Date(range.end.valueOf() + (widthInMilliseconds / 50)),
			{animation: false}
		);
	},

	_processOptions: function(container, optionsJson){
	  var parsedOptions = JSON.parse(optionsJson);

	  var snapStep = parsedOptions.snapStep;
	  delete parsedOptions.snapStep;

	  var autoZoom = parsedOptions.autoZoom;
	  delete parsedOptions.autoZoom;

	  // Not a vis option: gates the arrow.js dependency drawing. Stashed on the
	  // container so the event handlers below can consult it at any time.
	  container.arrowsEnabled = parsedOptions.arrowsEnabled !== false;
	  delete parsedOptions.arrowsEnabled;

	  var tooltipOnItemUpdateTime = parsedOptions.tooltipOnItemUpdateTime;
	  var tooltipDateFormat = parsedOptions.tooltipOnItemUpdateTimeDateFormat;
	  var tooltipTemplate = parsedOptions.tooltipOnItemUpdateTimeTemplate;
	  delete parsedOptions.tooltipOnItemUpdateTime;
	  delete parsedOptions.tooltipOnItemUpdateTimeDateFormat;
	  delete parsedOptions.tooltipOnItemUpdateTimeTemplate;

	  // `locale` itself IS a vis option (kept for its built-in UI strings);
	  // localeStrings is wrapper-only and feeds option.locales below.
	  var locale = parsedOptions.locale;
	  var localeStrings = parsedOptions.localeStrings;
	  delete parsedOptions.localeStrings;

	  var defaultOptions = {
		onMove: function(item, callback) {
			var oldItem = container.timeline._timeline.itemSet.itemsData.get(item.id);
			var isResizedItem = oldItem.end.getTime() - oldItem.start.getTime() !=  item.end.getTime() - item.start.getTime();
			var moveItem = true;

			if(isResizedItem && (item.start.getTime() >= item.end.getTime() || item.end.getTime() <= item.start.getTime())){
				moveItem = false;
			}

			if(moveItem) {
				callback(item); 							
				var startDate = window.vcftimeline._convertDate(item.start);
				var endDate = window.vcftimeline._convertDate(item.end);
				//update connections
				if (container.arrowsEnabled !== false) {
					window.vcftimeline._updateConnections(container);
				}
				//call server
				container.$server.onMove(item.id, startDate, endDate, isResizedItem);
			} else {
				// undo resize 
				callback(null);
			}
		},

		snap: function (date, scale, step) {
			var hour = snapStep * 60 * 1000;
			return Math.round(date / hour) * hour;
		},
	  };

	  var options = {};
	  Object.assign(options, parsedOptions, defaultOptions);

	  if (locale) {
		// vis-timeline bundles its own moment with data for its 10 built-in
		// languages; the npm moment knows every "moment/locale/<lang>" module
		// the application has imported. Moment's locale is global per copy
		// (and sticky), so reset it on both copies before applying the new
		// one, then format axis labels (TimeStep uses options.moment) with
		// the copy that actually knows the language. One locale per page.
		// Setting an unknown language returns the fallback instead, so the
		// return values also tell whether the locale data is there at all.
		visMoment.locale('en');
		var visLang = visMoment.locale(locale);
		moment.locale('en');
		var npmLang = moment.locale(locale);
		var npmKnown = String(npmLang).toLowerCase() === String(locale).toLowerCase();
		var visKnown = String(visLang).toLowerCase() === String(locale).toLowerCase();
		if (!npmKnown && !visKnown) {
		  // The application imported no moment data for this language: build
		  // one from the browser's Intl (CLDR) data rather than render English
		  // silently. An imported "moment/locale/<lang>" module stays the more
		  // exact source when present.
		  try {
		    _defineLocaleFromIntl(moment, locale);
		    npmLang = moment.locale(locale);
		    npmKnown = String(npmLang).toLowerCase() === String(locale).toLowerCase();
		  } catch (e) {
		    // Language tag Intl rejects: fall through to the warning.
		  }
		  if (!npmKnown && !_missingLocaleWarned[locale]) {
		    _missingLocaleWarned[locale] = true;
		    console.warn('[vcf-timeline] cannot localize "' + locale + '": neither an imported'
			    + ' "moment/locale/' + locale + '" module nor the browser\'s Intl data knows that'
			    + ' language tag; dates render in English.');
		  }
		}
		options.moment = npmKnown ? moment : visMoment;
		if (localeStrings) {
		  options.locales = {};
		  options.locales[locale] = localeStrings;
		}
	  } else {
		// Revert to English: the global locale of a previously used moment
		// copy and a previously injected options.moment would otherwise
		// stick, because vis keeps option keys it isn't given a new value
		// for.
		moment.locale('en');
		visMoment.locale('en');
		options.moment = visMoment;
		options.locale = 'en';
	  }

	  if(autoZoom && options.min && options.max){
		  options.start = options.min;
		  options.end = options.max;
	  }

	  if(tooltipOnItemUpdateTime){
		options.editable = {updateTime: true}, 
		options.tooltipOnItemUpdateTime = {
			template: function(item) {
		      var startDate = options.moment(item.start).format('L HH:mm'); // format with the copy the locale block selected
			  var endDate = options.moment(item.end).format('L HH:mm')
			  	
			  if(tooltipDateFormat){
				startDate = options.moment(item.start).format(tooltipDateFormat);
				endDate = options.moment(item.end).format(tooltipDateFormat);
			  }
			  if(tooltipTemplate){
				  var templateCopy = tooltipTemplate;
				  templateCopy = templateCopy.replace("item.start", startDate);
				  templateCopy = templateCopy.replace("item.end", endDate);	
				  return templateCopy;
			  } else {
				return "Start: " + startDate
				+ "</br> End: " + endDate;	
			  }
			}
		  }
	  }

	  return options;
	},

	setOptions: function(container, optionsJson) {
		var options = this._processOptions(container, optionsJson)
		if (!container.timeline) {
			return; // timeline creation still pending (see create); the flag
				        // stashed above is re-read by _createTimeline's options
		}
		container.timeline._timeline.setOptions(options);
		// Core has propagated the locale-selected moment to all components,
		// but the axis only repaints when the range changes; make sure it
		// repaints now, so labels pick up the new language immediately.
		var tl = container.timeline._timeline;
		if (options.moment) {
			if (tl.timeAxis) { tl.timeAxis.options.moment = options.moment; tl.timeAxis.redraw(); }
			if (tl.timeAxis2) { tl.timeAxis2.options.moment = options.moment; tl.timeAxis2.redraw(); }
		}
		// Sync already-drawn arrows with the arrowsEnabled flag _processOptions
		// just stashed: clear them when disabled, redraw when (re)enabled.
		if (container.arrowsEnabled) {
			this._updateConnections(container);
		} else {
			container.timeline.setDependencies([]);
		}
	},

  	addItem: function(container, newItemJson) {
		this.addItems(container, "[" + newItemJson + "]");
	},

	// Batched counterpart of addItem: ONE executeJs per server round trip's
	// worth of adds (the server buffers addItem() calls and flushes them here),
	// with a single fit() at the end. The per-item variant fitted per item,
	// and each fit() triggers a full redraw: a 25-row x 7-item load measured
	// 75 redraw storms (~1.7s of _origRedraw) where this path needs ~25.
	addItems: function(container, itemsJson) {
		if (this._queuePreCreate(container, 'addItems', [itemsJson])) {
			return;
		}
		var itemsData = container.timeline._timeline.itemsData;
		// Items added before create() also ride in its itemsJson (the server
		// keeps the item list and create() carries it), so the queue replay
		// must not duplicate what the constructor already placed: add only
		// the ids that are not in the DataSet yet.
		var existing = new Set(itemsData.getIds());
		JSON.parse(itemsJson).forEach(function(item) {
			if (item.id == undefined || !existing.has(item.id)) {
				itemsData.add(item);
				existing.add(item.id);
			}
		});
		container.timeline._timeline.fit();
	},

	setItems: function(container, itemsJson) {
		if (this._queuePreCreate(container, 'setItems', [itemsJson])) {
			return;
		}
		var items = new DataSet(JSON.parse(itemsJson));
		container.timeline._timeline.setItems(items);
		container.timeline._timeline.fit();
	},

	// create() defers the vis constructor by a setTimeout, so server commands
	// sent in the same round trip as attach execute while container.timeline
	// is still undefined and used to throw "reading '_timeline'" — an uncaught
	// throw aborts the remaining commands of that response. Queue such calls
	// and replay them once the constructor has run (_flushPendingCalls).
	// setOptions/setGroups have their own pre-create handling and are not
	// routed through here.
	_queuePreCreate: function(container, name, args) {
		if (container.timeline != undefined && container.timeline._timeline != undefined) {
			return false;
		}
		if (container.pendingCalls == undefined) {
			container.pendingCalls = [];
		}
		container.pendingCalls.push({ name: name, args: args });
		return true;
	},

	_flushPendingCalls: function(container) {
		var pending = container.pendingCalls;
		if (pending == undefined || pending.length == 0) {
			return;
		}
		// cleared BEFORE replay so calls arriving during it take the live path
		container.pendingCalls = undefined;
		var me = this;
		pending.forEach(function(call) {
			me[call.name].apply(me, [container].concat(call.args));
		});
	},

	setGroups: function(container, groupsJson) {
		var groups = new DataSet(JSON.parse(groupsJson));
		// Pass null to vis when the list is empty: an empty DataSet would keep
		// the timeline in grouped mode and ungrouped items would not render.
		if (container.timeline) {
			container.timeline._timeline.setGroups(groups.getIds().length > 0 ? groups : null);
			container.groupsDataSet = groups;
		} else {
			// timeline creation still pending (see create): stash for _createTimeline
			container.pendingGroupsDataSet = groups.getIds().length > 0 ? groups : null;
			container.groupsDataSet = null;
		}
	},
	
	revertMove: function(container, itemId, itemJson) {
	    var itemData = container.timeline._timeline.itemSet.items[itemId].data;
	    var parsedItem = JSON.parse(itemJson);
		itemData.start = parsedItem.start;
		itemData.end = parsedItem.end;

		let calculatedLeft = container.timeline._timeline.itemSet.items[itemId].conversion.toScreen(moment(itemData.start));
   		container.timeline._timeline.itemSet.items[itemId].left = calculatedLeft;

		container.timeline._timeline.itemsData.update(itemData);
	},
	
	removeItem: function(container, itemId) {
		if (this._queuePreCreate(container, 'removeItem', [itemId])) {
			return;
		}
		container.timeline._timeline.itemsData.remove(itemId);
		container.$server.onRemove(itemId);
	},

	updateItemContent: function(container, itemId, newContent) {
		if (this._queuePreCreate(container, 'updateItemContent', [itemId, newContent])) {
			return;
		}
		var itemData = container.timeline._timeline.itemSet.items[itemId].data;
		itemData.content = newContent;
		container.timeline._timeline.itemsData.update(itemData);
	},
	
	setZoomOption: function(container, zoomDays) {
		var startDate;
		var selectedItems = container.timeline._timeline.getSelection();
		if(selectedItems.length > 0){
			var selectedItem = selectedItems.length > 1 ? this._sortItems(selectedItems)[0] : selectedItems[0];
			startDate = container.timeline._timeline.itemSet.items[selectedItem].data.start;
		} else {
			var range = container.timeline._timeline.getWindow();
			startDate = range.start;
		}

		var start = moment(startDate);
		start.hour(0);
		start.minutes(0);
		start.seconds(0);

		var end = moment(startDate);
		end.add(zoomDays, 'days');
		
		container.timeline._timeline.setWindow({
			start: start,
			end: end,
		});
	},
	
	_convertDate: function(date) {
		var local = new Date(date);
		local.setMinutes(date.getMinutes() - date.getTimezoneOffset());
		return local.toJSON().slice(0, 19);		
	},  
	
	_sortItems: function(items) {
	  var sortedItems = items.sort(function(item1, item2) {
		var item1_date = new Date(item1.start), item2_date = new Date(item2.start);
		return item1_date - item2_date;
	  });
	  return sortedItems;
	},

	_createConnections: function(items) {
	  // Sort items in order to be able to create connections for timeline-arrow
	  // (horizontal line)
	  var sortedItems = this._sortItems(items);

	  // Chain items within their row only: with groups, each group renders in
	  // its own row and an arrow must never jump between rows. Ungrouped
	  // timelines have a single implicit row (group undefined), which keeps the
	  // original connect-consecutive-by-start-time behavior unchanged.
	  var byGroup = new Map();
	  sortedItems.forEach(function(item) {
		var key = item.group == null ? "" : String(item.group);
		var bucket = byGroup.get(key);
		if (bucket == undefined) {
		  bucket = [];
		  byGroup.set(key, bucket);
		}
		bucket.push(item);
	  });

      // Create connections for items
	  var connections = [];
	  var id = 1;
	  byGroup.forEach(function(groupItems) {
		  for(let i = 0; i < groupItems.length-1; i++) {
			  var element = groupItems[i];
			  var nextElement = groupItems[i + 1];

			  // Only chain when nextElement actually follows element in time.
			  // Overlapping items are stacked side by side, not sequenced:
			  // an arrow between them would point backwards and is not a
			  // "leads to" relationship.
			  if (new Date(nextElement.start).valueOf() < new Date(element.end).valueOf()) {
				  continue;
			  }

			  var item = {}
			  item ["id"] = id++;
			  item ["id_item_1"] = element.id;
			  item ["id_item_2"] = nextElement.id;

			  connections.push(item);
		  }
	  });
	  return connections;
	},
	
	_updateConnections: function(container) {
		var connections = this._createConnections(container.timeline._timeline.itemsData.get());
		container.timeline.setDependencies(connections);
	},

	_updateTimelineHeight: function(container) {
		// With groups, vis-timeline's native auto height (options.height left
		// undefined) grows the main area to fit every group row. Freezing the
		// height to the first measured container rect would clip the last
		// group's row, so skip the freeze while groups are present and undo
		// it if a freeze from the ungrouped state is still in effect.
		if(container.groupsDataSet != undefined && container.groupsDataSet.getIds().length > 0){
			if(container.timelineHeight != undefined
					&& container.timeline._timeline.options.height == container.timelineHeight){
				container.timeline._timeline.options.height = undefined;
				// Clearing the option is not enough: vis only re-reads it at the
				// start of a redraw, and the changed event we are running in fires
				// after that redraw — without another one the height-freeze would
				// stay in effect on screen until some later, unrelated redraw.
				container.timeline._timeline.redraw();
			}
			container.timelineHeight = undefined;
			return;
		}
		if(container.timelineHeight == undefined){
			container.timelineHeight = container.timeline._timeline.dom.container.getBoundingClientRect().height;
		}
		if(container.timeline._timeline.options.height == undefined){
			container.timeline._timeline.options.height = container.timelineHeight;
		}
		// The freeze above is armed on the FIRST changed event, and that races
		// with vis's initial fit and item stacking (with server push the first
		// changed often lands before the layout has settled, most reliably after
		// a browser refresh): measured too early the recorded height is the
		// pre-stacking one (~30px), and since every later redraw takes its height
		// from options.height, the timeline stays collapsed with the grown
		// itemset inside it. Schedule a bounded self-check that heals such a
		// stale freeze; see _ensureFrozenHeight.
		if(container.frozenHeightChecked == undefined){
			container.frozenHeightChecked = true;
			var me = this;
			var timeline = container.timeline._timeline;
			var deadline = Date.now() + 2500;
			requestAnimationFrame(function() {
				me._ensureFrozenHeight(container, timeline, deadline);
			});
		}
	},

	// Healer for the ungrouped height freeze in _updateTimelineHeight: while OUR
	// freeze is in effect (options.height still equals our own measurement, so a
	// height set elsewhere is never touched) and the stacked items no longer fit
	// the frozen box, clear BOTH values and redraw — the changed event that
	// follows then re-freezes, as usual, but to the now-correct grown height.
	// Checks repeat every 150ms until a short grace deadline, because a too-early
	// first changed can even precede the items arriving over push. The deadline
	// is what keeps this out of later user interaction: once the timeline is
	// live, pinning the height is the intended behaviour (synced rows must not
	// jump while zooming), so only the initial-load race may be healed.
	_ensureFrozenHeight: function(container, timeline, deadline) {
		if (!container.timeline || container.timeline._timeline !== timeline) {
			return; // timeline destroyed or rebuilt in the meantime
		}
		if (!timeline.dom.centerContainer.isConnected) {
			return; // detached from the page
		}
		if (!timeline.options.verticalScroll) {
			// not for vertical-scroll layouts: content taller than the box is
			// the point there, not a stale freeze
			var frame = timeline.itemSet != undefined ? timeline.itemSet.dom.frame : undefined;
			var stale = frame != undefined
					&& container.timelineHeight != undefined
					&& timeline.options.height == container.timelineHeight
					&& frame.offsetHeight > timeline.dom.centerContainer.clientHeight + 1;
			if (stale) {
				container.timelineHeight = undefined;
				timeline.options.height = undefined;
				timeline.redraw();
			}
		}
		if (Date.now() < deadline) {
			var me = this;
			setTimeout(function() {
				me._ensureFrozenHeight(container, timeline, deadline);
			}, 150);
		}
	},

	// Grouped timelines could start out with collapsed .vis-group rows after a
	// browser refresh: vis lays the rows out during the constructor's first
	// draw, which runs against its default window ("around now"); the initial
	// fit then only moves the range, and the follow-up redraw restacks the
	// items but not the group rows. The rows only restack on the next FULL
	// redraw — on a first navigation one happens to come from the container
	// settling (scrollbar), but after a refresh the layout is already stable
	// and it never comes, so the rows keep their empty-window heights. Force
	// that redraw once, on the frame after the first changed event: vis's
	// internal initial fit is handled in the constructor, i.e. before the
	// changed handler below runs, so by then the window is already final.
	//
	// One forced redraw is not always enough, see _ensureInitialMainHeight
	// below; that retry covers the case where the rows do restack but the
	// main panel stays at its collapsed height anyway.
	_restackInitialGroupRows: function(container) {
		if (container.initialGroupRowsRestacked != undefined) {
			return;
		}
		if (container.groupsDataSet == undefined || container.groupsDataSet.getIds().length == 0) {
			return; // ungrouped: nothing to restack; stay armed in case groups arrive later
		}
		container.initialGroupRowsRestacked = true;
		var timeline = container.timeline._timeline;
		requestAnimationFrame(() => requestAnimationFrame(() => {
			if (container.timeline && container.timeline._timeline === timeline) {
				timeline.itemSet.markDirty({ restackGroups: true, refreshItems: true });
				timeline.redraw();
				this._ensureInitialMainHeight(container, timeline, 0);
			}
		}));
	},

	// The other half of the refresh-collapse bug: .vis-itemset ends up at its
	// correct (stacked) height while .vis-panel.vis-center keeps the collapsed
	// height, so the rows render clipped inside a 30px-tall box. That state is
	// what vis leaves behind when its auto-height bookkeeping runs out of
	// steam: Core._redraw measures the center panel BEFORE redrawing the
	// components, so a redraw whose own restack grows the rows writes the
	// PREVIOUS pass' height into the root element and then relies on vis's
	// internal _change loop to schedule yet another pass that measures the
	// grown content. That follow-up loop can end without one: its redraws go
	// through a throttled wrapper whose calls during the initial event storm
	// get dropped, and after MAX_REDRAW=5 chained passes vis gives up with a
	// console warning "infinite loop in redraw?". vis fires no event for
	// "loop finished", so instead we verify the outcome ourselves: while the
	// group rows total more height than the main panel offers, force one more
	// full redraw, timed outside vis's throttle window. The first attempt is
	// unconditional because vis empties itemSet.groupIds in markDirty, so a
	// row-total of 0 after a swallowed restack cannot be told apart from an
	// unstacked layout; from the second attempt on the row-total check is
	// meaningful and a healthy load stops right there. Bounded either way.
	_ensureInitialMainHeight: function(container, timeline, attempts) {
		if (attempts > 15) {
			return; // give up rather than risk redraw churn on a pathological layout
		}
		if (!container.timeline || container.timeline._timeline !== timeline) {
			return; // timeline destroyed or rebuilt in the meantime
		}
		if (!timeline.dom.centerContainer.isConnected) {
			return; // detached from the page
		}
		if (timeline.options.height != undefined || timeline.options.verticalScroll) {
			return; // explicitly sized / scrollable: the panel need not fit the rows
		}
		var broken = attempts == 0; // see comment above
		if (!broken) {
			var groupHeight = 0;
			timeline.itemSet.groupIds.forEach(function(id) {
				var group = timeline.itemSet.groups[id];
				if (group != undefined) {
					groupHeight += group.height;
				}
			});
			broken = groupHeight > timeline.dom.centerContainer.clientHeight + 1;
		}
		if (broken) {
			timeline.itemSet.markDirty({ restackGroups: true, refreshItems: true });
			timeline.redraw();
			var me = this;
			setTimeout(function() {
				me._ensureInitialMainHeight(container, timeline, attempts + 1);
			}, 150);
		}
	}
}



