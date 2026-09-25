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

import { DataSet, Timeline } from 'vis-timeline/standalone/umd/vis-timeline-graph2d.min.js';

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
	  });

	  container.timeline._timeline.on('select', (properties) => {
		container.$server.onSelect(properties.items);
	  });

	  var mouseX;
	  container.timeline._timeline.on('mouseMove', (properties) => {
		mouseX = properties.event.clientX;
	  });

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

	  if(autoZoom && options.min && options.max){
		  options.start = options.min;
		  options.end = options.max;
	  }

	  if(tooltipOnItemUpdateTime){
		options.editable = {updateTime: true}, 
		options.tooltipOnItemUpdateTime = {
			template: function(item) {
		      var startDate = moment(item.start).format('MM/DD/YYYY HH:mm');
			  var endDate = moment(item.end).format('MM/DD/YYYY HH:mm')
			  	
			  if(tooltipDateFormat){
				startDate = moment(item.start).format(tooltipDateFormat);
				endDate = moment(item.end).format(tooltipDateFormat);
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
		// Sync already-drawn arrows with the arrowsEnabled flag _processOptions
		// just stashed: clear them when disabled, redraw when (re)enabled.
		if (container.arrowsEnabled) {
			this._updateConnections(container);
		} else {
			container.timeline.setDependencies([]);
		}
	},

  	addItem: function(container, newItemJson) {
		container.timeline._timeline.itemsData.add(JSON.parse(newItemJson));
		container.timeline._timeline.fit();
	},

	setItems: function(container, itemsJson) {
		var items = new DataSet(JSON.parse(itemsJson));
		container.timeline._timeline.setItems(items);
		container.timeline._timeline.fit();
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
		container.timeline._timeline.itemsData.remove(itemId);
		container.$server.onRemove(itemId);
	},

	updateItemContent: function(container, itemId, newContent) {
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
	}
}



