/*-
 * #%L
 * Timeline
 * %%
 * Copyright (C) 2021 -2026 Vaadin Ltd
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

package com.vaadin.componentfactory.timeline;

import com.vaadin.componentfactory.timeline.event.ItemRemoveEvent;
import com.vaadin.componentfactory.timeline.event.ItemResizeEvent;
import com.vaadin.componentfactory.timeline.event.ItemsDragAndDropEvent;
import com.vaadin.componentfactory.timeline.model.AxisOrientation;
import com.vaadin.componentfactory.timeline.model.Group;
import com.vaadin.componentfactory.timeline.model.Item;
import com.vaadin.componentfactory.timeline.model.SnapStep;
import com.vaadin.componentfactory.timeline.model.TimelineOptions;
import com.vaadin.componentfactory.timeline.util.TimelineUtil;
import com.vaadin.flow.component.AttachEvent;
import com.vaadin.flow.component.ClientCallable;
import com.vaadin.flow.component.ComponentEventListener;
import com.vaadin.flow.component.dependency.CssImport;
import com.vaadin.flow.component.dependency.JsModule;
import com.vaadin.flow.component.dependency.NpmPackage;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.internal.Pair;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Timeline component definition. Timeline uses vis-timeline component to display data in time (see
 * more at https://github.com/visjs/vis-timeline).
 */
@SuppressWarnings("serial")
@NpmPackage(value = "vis-timeline", version = "7.4.9")
@NpmPackage(value = "moment", version = "2.29.1")
@JsModule("./src/arrow.js")
@JsModule("./src/vcf-timeline.js")
@CssImport("vis-timeline/styles/vis-timeline-graph2d.min.css")
@CssImport("./styles/timeline.css")
public class Timeline extends Div {

  private List<Item> items = new ArrayList<>();

  private List<Group> groups = new ArrayList<>();

  private TimelineOptions timelineOptions = new TimelineOptions();

  private List<String> selectedItemsIdsList = new ArrayList<>();
  
  private Map<String, Pair<LocalDateTime, LocalDateTime>> movedItemsMap = new HashMap<>();
  
  private Map<String, Pair<LocalDateTime, LocalDateTime>> movedItemsOldValuesMap = new HashMap<>();

  /**
   * Item JSONs queued by {@link #addItem(Item)} since the last client round
   * trip; flushed as ONE executeJs (vcftimeline.addItems) instead of one call
   * per item, which caused a redraw storm per added item (see
   * {@link #flushPendingAdds()}).
   */
  private List<String> pendingAddItemJsons = new ArrayList<>();

  /** Whether a flush of {@link #pendingAddItemJsons} is already scheduled. */
  private boolean addItemFlushScheduled = false;

  public Timeline() {
    setId("visualization" + this.hashCode());
    setWidthFull();
    setClassName("timeline");
  }

  public Timeline(List<Item> items) {
    this();
    this.items = new ArrayList<>(items);
  }

  public Timeline(List<Item> items, List<Group> groups) {
    this(items);
    this.groups = new ArrayList<>(groups);
  }

  protected TimelineOptions getTimelineOptions() {
    return this.timelineOptions;
  }

  @Override
  protected void onAttach(AttachEvent attachEvent) {
    super.onAttach(attachEvent);
    selectedItemsIdsList = new ArrayList<>();
    movedItemsMap = new HashMap<>();
    movedItemsOldValuesMap = new HashMap<>();
    initTimeline();
  }

  private void initTimeline() {
    // Anything addItem() buffered while detached is carried by the create
    // call below (it serializes this.items as of now), so it must NOT also be
    // flushed as separate adds — the connector would only dedupe it by id.
    pendingAddItemJsons.clear();
    addItemFlushScheduled = false;
    this.getElement()
        .executeJs(
            "vcftimeline.create($0, $1, $2, $3)",
            this,
            "[" + convertItemsToJson() + "]",
            "[" + convertGroupsToJson() + "]",
            getTimelineOptions().toJSON());
  }

  private String convertItemsToJson() {
    return this.items != null
        ? this.items.stream().map(item -> item.toJSON()).collect(Collectors.joining(","))
        : "";
  }

  private String convertGroupsToJson() {
    return this.groups != null
        ? this.groups.stream().map(group -> group.toJSON()).collect(Collectors.joining(","))
        : "";
  }

  /**
   * Add a new item to the timeline.
   *
   * @param item the new item to add to the timeline
   */
  public void addItem(Item item) {
    this.items.add(item);
    if (getElement().getNode().isAttached()) {
      // Buffered and sent as a single addItems call at the end of this round
      // trip. While detached there is nothing to send: onAttach's create
      // call carries the whole item list to the client anyway.
      pendingAddItemJsons.add(item.toJSON());
      scheduleAddItemsFlush();
    }
  }

  private void scheduleAddItemsFlush() {
    if (addItemFlushScheduled) {
      return;
    }
    getUI()
        .ifPresent(
            ui -> {
              addItemFlushScheduled = true;
              ui.beforeClientResponse(this, context -> flushPendingAdds());
            });
  }

  /**
   * Sends every item buffered by {@link #addItem(Item)} since the last flush
   * in one executeJs call. Per-item calls each triggered a vis fit+redraw, so
   * a load adding N items fired N redraw storms; one batched call fits once.
   * Also called inline before other item-targeting commands, to keep client
   * side command order consistent with the server side call order.
   */
  private void flushPendingAdds() {
    addItemFlushScheduled = false;
    if (pendingAddItemJsons.isEmpty()) {
      return;
    }
    String itemsJson = "[" + String.join(",", pendingAddItemJsons) + "]";
    pendingAddItemJsons.clear();
    this.getElement().executeJs("vcftimeline.addItems($0, $1)", this, itemsJson);
  }

  public void setItems(List<Item> items) {
    flushPendingAdds();
    this.items = new ArrayList<>(items);
    this.getElement()
        .executeJs("vcftimeline.setItems($0, $1)", this, "[" + convertItemsToJson() + "]");
  }

  /**
   * Return the list of items that are currently part of the timeline.
   *
   * @return the list of items of the timeline
   */
  public List<Item> getItems() {
    return items;
  }

  /**
   * Sets the groups of the timeline. Items are assigned to a group through
   * {@link Item#setGroup(String)}. An empty list (the default) means no
   * grouping: items are rendered ungrouped, as in timelines without groups.
   *
   * @param groups the list of groups of the timeline
   */
  public void setGroups(List<Group> groups) {
    this.groups = new ArrayList<>(groups);
    updateGroups();
  }

  /**
   * Return the list of groups that are currently part of the timeline.
   *
   * @return the list of groups of the timeline
   */
  public List<Group> getGroups() {
    return groups;
  }

  /**
   * Add a new group to the timeline.
   *
   * @param group the new group to add to the timeline
   */
  public void addGroup(Group group) {
    this.groups.add(group);
    updateGroups();
  }

  /**
   * Remove a group from the timeline. Items still referencing the removed
   * group are rendered ungrouped.
   *
   * @param groupId id of the group to remove
   */
  public void removeGroup(String groupId) {
    this.groups.removeIf(group -> groupId.equals(group.getId()));
    updateGroups();
  }

  /** Remove all groups, rendering every item ungrouped. */
  public void clearGroups() {
    this.groups.clear();
    updateGroups();
  }

  private void updateGroups() {
    this.getElement()
        .executeJs("vcftimeline.setGroups($0, $1)", this, "[" + convertGroupsToJson() + "]");
  }

  /**
   * Sets visible range for timeline.
   *
   * @param min minimum date
   * @param max maximum date
   */
  public void setTimelineRange(LocalDateTime min, LocalDateTime max) {
    getTimelineOptions().min = min;
    getTimelineOptions().max = max;
    updateTimelineOptions();
  }

  /**
   * Sets orientation of the timeline axis. By default axis is on top.
   *
   * @param axisOrientation orientation of the timeline axis
   */
  public void setAxisOrientation(AxisOrientation axisOrientation) {
    getTimelineOptions().axisOrientation = axisOrientation.getName();
    updateTimelineOptions();
  }

  /**
   * Sets whether the timeline can be zoomed by pinching or scrolling in the window. By default,
   * timeline is zoomable. Option moveable shoul be true.
   *
   * @param zoomable true if timeline is zoomable
   */
  public void setZoomable(boolean zoomable) {
    getTimelineOptions().zoomable = zoomable;
    updateTimelineOptions();
  }

  /**
   * Sets wheter the timeline can be moved by dragging the window. By default, timeline is moveable.
   *
   * @param moveable true if timeline is moveable
   */
  public void setMoveable(boolean moveable) {
    getTimelineOptions().moveable = moveable;
    updateTimelineOptions();
  }

  /**
   * Sets zoom range for timeline.
   *
   * @param zoomMin minimum zoom interval
   * @param zoomMax maximum zoom interval
   */
  public void setZoomRange(Long zoomMin, Long zoomMax) {
    getTimelineOptions().zoomMin = zoomMin;
    getTimelineOptions().zoomMax = zoomMax;
    updateTimelineOptions();
  }

  /**
   * Sets wheter the items in the timeline can be selected. By default, items are selectables.
   *
   * @param selectable true if times can be selected
   */
  public void setSelectable(boolean selectable) {
    getTimelineOptions().selectable = selectable;
    updateTimelineOptions();
  }

  /**
   * Sets whether a vertical bar at current time is displayed. By default, not current time is
   * displayed.
   *
   * @param showCurrentTime true if current time is shown
   */
  public void setShowCurentTime(boolean showCurrentTime) {
    getTimelineOptions().showCurrentTime = showCurrentTime;
    updateTimelineOptions();
  }

  /**
   * Sets the height of the timeline. Value can be in pixles or as percentaje (e.g. "300px"). When
   * height is undefined or null, the height of the timeline is automatically adjusted to fit the
   * contents.
   */
  @Override
  public void setHeight(String height) {
    getTimelineOptions().height = height;
    updateTimelineOptions();
  }

  /** Sets the maximum height for the timeline. */
  @Override
  public void setMaxHeight(String maxHeight) {
    getTimelineOptions().maxHeight = maxHeight;
    updateTimelineOptions();
  }

  /**
   * Sets the initial start date for the axis of the timeline. If it's not provided, the earliest
   * date present in the events is taken as start date.
   * 
   * If autoZoom is true, this option will be override.
   *
   * @param start initial start date
   */
  public void setStart(LocalDateTime start) {
    getTimelineOptions().start = start;
    updateTimelineOptions();
  }
  
  /**
   * Sets whether all range should be visible at once. 
   * Only works if a range was defined by calling {@link #setTimelineRange}.
   * It will set start and end for timeline axis. 
   * 
   * @param autoZoom true if autozoom is allowed
   */
  public void setAutoZoom(boolean autoZoom) {
    getTimelineOptions().autoZoom = autoZoom;
    updateTimelineOptions();
  }
  
  /**
   * The initial end date for the axis of the timeline. If not provided, the latest date present 
   * in the items set is taken as end date.
   * 
   * If autoZoom is true, this option will be override.
   * 
   * @param end initial end date
   */
  public void setEnd(LocalDateTime end) {
    getTimelineOptions().end = end;
    updateTimelineOptions();
  }

  /**
   * Sets whether items will be stack on top of each other if they overlap. By default item will not
   * stack.
   *
   * @param stack true if items should stack
   */
  public void setStack(boolean stack) {
    getTimelineOptions().stack = stack;
    updateTimelineOptions();
  }

  /**
   * Sets whether the connection arrows between consecutive items are drawn.
   * The arrows are rendered client-side by the bundled arrow.js script, which
   * chains items in time order; disabling them stops that script from drawing
   * and removes any arrows already drawn. By default arrows are enabled.
   *
   * @param arrowsEnabled true if connection arrows should be drawn
   */
  public void setArrowsEnabled(boolean arrowsEnabled) {
    getTimelineOptions().arrowsEnabled = arrowsEnabled;
    updateTimelineOptions();
  }

  /**
   * Sets the group property name used to order the group rows vertically.
   * Supported values are "order", "content" and "id". By default groups are
   * ordered by insertion order.
   *
   * @param groupOrder name of the group property used to order groups
   */
  public void setGroupOrder(String groupOrder) {
    getTimelineOptions().groupOrder = groupOrder;
    updateTimelineOptions();
  }

  /**
   * Sets whether multiple items can be selected. Option selectable should be true. By default,
   * multiselect is disabled.
   *
   * @param multiselect true if multiselect is allowed
   */
  public void setMultiselect(boolean multiselect) {
    getTimelineOptions().multiselect = multiselect;
    updateTimelineOptions();
  }  
  
  /**
   * Sets whether tooltips will be displaying for items with defined titles. By default, tooltips
   * will be visibles.
   *
   * @param showTooltips true if tooltips should be shown
   */
  public void setShowTooltips(boolean showTooltips) {
    getTimelineOptions().showTooltips = showTooltips;
    updateTimelineOptions();
  }
 
  /**
   * Updates content of an existing item.
   *
   * @param itemId id of item to be updated
   * @param newContent new item content
   */
  public void updateItemContent(String itemId, String newContent) {
    flushPendingAdds();
    this.getElement()
        .executeJs("vcftimeline.updateItemContent($0, $1, $2)", this, itemId, newContent);
    items.stream()
        .filter(i -> itemId.equals(i.getId()))
        .findFirst()
        .ifPresent(
            item -> {
              item.setContent(newContent);
            });
  }

  /**
   * Sets snap value. It can be an hour, half an hour or fifteen minutes. By default it is set at
   * fifteeen minutes.
   *
   * @param snapStep snap value
   */
  public void setSnapStep(SnapStep snapStep) {
    getTimelineOptions().snapStep = snapStep.getMinutes();
    updateTimelineOptions();
  }

  /**
   * Sets zoom option for timeline.
   *
   * @param zoomOption integer representing days for zooming
   */
  public void setZoomOption(Integer zoomOption) {
    this.getElement().executeJs("vcftimeline.setZoomOption($0, $1)", this, zoomOption);
    updateTimelineOptions();
  }

  /**
   * Sets the locale used to localize the timeline axis and tooltip dates, e.g.
   * "hu" for Hungarian. Month and day names are resolved on the client from the
   * moment.js locale data registered for that language: the languages bundled
   * with vis-timeline (en, de, es, fr, it, ja, nl, pl, ru, uk) work out of the
   * box, any other language requires the matching "moment/locale/&lt;lang&gt;"
   * module to be imported in the application frontend (see the demo's locale
   * example). Note that moment.js locales are global: all timelines on the same
   * page share the last locale set. Defaults to English.
   *
   * @param locale IETF language tag, or null to revert to English
   */
  public void setLocale(String locale) {
    TimelineOptions options = getTimelineOptions();
    options.locale = locale;
    // Custom UI strings belong to the locale they were written for; drop
    // them so a new locale doesn't render the previous language's labels.
    options.localeStrings = null;
    updateTimelineOptions();
  }

  /**
   * Sets the locale used to localize the timeline axis and tooltip dates, see
   * {@link #setLocale(String)}.
   *
   * @param locale locale to use, or null to revert to English
   */
  public void setLocale(Locale locale) {
    setLocale(locale == null ? null : locale.toLanguageTag());
  }

  /**
   * Sets the UI strings displayed by the timeline itself (the current time
   * indicator label, the tooltip time label and the delete button caption),
   * for languages vis-timeline ships no built-in strings for. They are used
   * when the locale set via {@link #setLocale(String)} has no built-in entry.
   *
   * @param current
   *            current time indicator label, e.g. "aktuális"
   * @param time
   *            label used in the current time tooltip, e.g. "idő"
   * @param deleteSelected
   *            caption of the delete button, e.g. "Kijelölés törlése"
   */
  public void setLocaleStrings(String current, String time, String deleteSelected) {
    Map<String, String> strings = new LinkedHashMap<>();
    if (current != null) {
      strings.put("current", current);
    }
    if (time != null) {
      strings.put("time", time);
    }
    if (deleteSelected != null) {
      strings.put("deleteSelected", deleteSelected);
    }
    getTimelineOptions().localeStrings = strings;
    updateTimelineOptions();
  }

  /**
   * Updates timeline options after timeline creation.
   */
  private void updateTimelineOptions() {
    if(this.getElement().getNode().isAttached()) {
      this.getElement().executeJs("vcftimeline.setOptions($0, $1)", this, getTimelineOptions().toJSON());
    }
  }
  
  /**
   * Call from client when an item is moved (dragged and dropped or resized).
   * 
   * @param itemId id of the moved item
   * @param itemNewStart new start date of the moved item
   * @param itemNewEnd new end date of the moved item
   * @param resizedItem true if item was resized 
   */
  @ClientCallable
  public void onMove(String itemId, String itemNewStart, String itemNewEnd, boolean resizedItem) {
    LocalDateTime newStart = TimelineUtil.convertLocalDateTime(itemNewStart);
    LocalDateTime newEnd = TimelineUtil.convertLocalDateTime(itemNewEnd);
    
    if(resizedItem) {
      fireItemResizeEvent(itemId, newStart, newEnd, true);
    } else {
      handleDragAndDrop(itemId, newStart, newEnd, true);
    }    
  }

  /**
   * Fires a {@link ItemResizeEvent}.
   *
   * @param itemId id of the item that was moved
   * @param newStart new start date for the item
   * @param newEnd new end date for the item
   * @param fromClient if event comes from client
   */
  protected void fireItemResizeEvent(
      String itemId, LocalDateTime newStart, LocalDateTime newEnd, boolean fromClient) {
    ItemResizeEvent event = new ItemResizeEvent(this, itemId, newStart, newEnd, fromClient);    
    RuntimeException exception = null;
    
    try {
      fireEvent(event);
    } catch (RuntimeException e) {
      exception = e;
      event.setCancelled(true);
    }    
    
    if (event.isCancelled()) {
      // if update is cancelled, revert item resizing
      revertMove(itemId);
      // if exception was catch, re-throw exception
      if(exception != null) {
        throw exception;
      }
    } else {
      // update item in list
      updateItemRange(itemId, newStart, newEnd);
    }      
  }
  
  /**
   * Handle item moved by drag and drop.
   * 
   * @param itemId id of the item that was moved
   * @param newStart new start date for the item
   * @param newEnd new end date for the item
   * @param fromClient if event comes from client
   */
  protected void handleDragAndDrop(String itemId, LocalDateTime newStart, LocalDateTime newEnd, boolean fromClient)  {
    // save current moved item - itemId - new start and new end
    movedItemsMap.put(itemId, new Pair<>(newStart, newEnd));
    // save original start and end for the moved item
    Item movedItem = items.stream().filter(i -> itemId.equals(i.getId())).findFirst().get();
    movedItemsOldValuesMap.put(itemId, new Pair<>(movedItem.getStart(), movedItem.getEnd()));
    
    // if all selected items have been processed
    if(selectedItemsIdsList.size() == movedItemsMap.size()){
      // update items with new start and end range values
      updateMovedItemsRange();
      List<Item> updatedItems = items.stream()
          .filter(item -> movedItemsMap.keySet().contains(item.getId())).collect(Collectors.toList());
      ItemsDragAndDropEvent event = new ItemsDragAndDropEvent(this, updatedItems, fromClient);      
      RuntimeException exception = null;
      
      try {
        fireEvent(event);
      } catch (RuntimeException e) {
        exception = e;
        event.setCancelled(true);
      }    
      
      if(event.isCancelled()) {
        // if move is cancelled, revert move for all dragged items
        revertMovedItemsRange();
        movedItemsMap.clear();
        movedItemsOldValuesMap.clear();
        // if exception was catch, re-throw the exception for error handling
        if(exception != null) {
          throw exception;
        }
      } else {
        // if move not cancelled, keep updated values
        movedItemsMap.clear();
        movedItemsOldValuesMap.clear();
      }      
    }
  }  
  
  private void revertMovedItemsRange() {
    for (String itemId : movedItemsOldValuesMap.keySet()) {
      items.stream().filter(i -> itemId.equals(i.getId())).findFirst().ifPresent(item -> {
        item.setStart(movedItemsOldValuesMap.get(itemId).getFirst());
        item.setEnd(movedItemsOldValuesMap.get(itemId).getSecond());
      });
    }
    
    for (String itemId : movedItemsOldValuesMap.keySet()) {
      revertMove(itemId);
    }
  }
  
  private void revertMove(String itemId) {
    Item item =
        items.stream()
            .filter(i -> itemId.equals(i.getId()))
            .findFirst()
            .orElse(null);
    if (item != null) {
      this.getElement()
          .executeJs("vcftimeline.revertMove($0, $1, $2)", this, itemId, item.toJSON());
    }
  }
  
  private void updateMovedItemsRange() {
    for(String itemId: movedItemsMap.keySet()) {
      updateItemRange(itemId, movedItemsMap.get(itemId).getFirst(), movedItemsMap.get(itemId).getSecond());
    }        
  }
  
  private void updateItemRange(String itemId, LocalDateTime newStart, LocalDateTime newEnd) {
    items.stream()
    .filter(i -> itemId.equals(i.getId()))
    .findFirst()
    .ifPresent(
        item -> {
          item.setStart(newStart);
          item.setEnd(newEnd);
        });
  }

  /**
   * Adds a listener for {@link ItemResizeEvent} to the component.
   *
   * @param listener the listener to be added
   */
  public void addItemResizeListener(ComponentEventListener<ItemResizeEvent> listener) {
    addListener(ItemResizeEvent.class, listener);
  }
    
  /**
   * Removes an item.
   *
   * @param item item to be removed.
   */
  public void removeItem(Item item) {
    flushPendingAdds();
    this.getElement().executeJs("vcftimeline.removeItem($0, $1)", this, item.getId());
  }

  /**
   * Call from client when an item is removed.
   *
   * @param itemId id of the removed item
   */
  @ClientCallable
  public void onRemove(String itemId) {
    fireItemRemoveEvent(itemId, true);
  }

  /**
   * Fires a {@link ItemRemoveEvent}.
   *
   * @param itemId id of the removed item
   * @param fromClient if event comes from client
   */
  public void fireItemRemoveEvent(String itemId, boolean fromClient) {
    ItemRemoveEvent event = new ItemRemoveEvent(this, itemId, fromClient);
    // update items list
    items.removeIf(item -> itemId.equals(item.getId()));
    fireEvent(event);
  }

  /**
   * Adds a listener for {@link ItemRemoveEvent} to the component.
   *
   * @param listener the listener to be added.
   */
  public void addItemRemoveListener(ComponentEventListener<ItemRemoveEvent> listener) {
    addListener(ItemRemoveEvent.class, listener);
  }
  
  /**
   * Call from client when items are selected.
   * 
   * @param selectedItemsIds list of selected items
   */
  @ClientCallable
  public void onSelect(String[] selectedItemsIds) {
    selectedItemsIdsList.clear();   
    selectedItemsIdsList.addAll(Arrays.asList(selectedItemsIds));
  }
   
  /**
   * Adds a listener for {@link ItemsDragAndDropEvent} to the component.
   * 
   * @param listener the listener to be added
   */
  public void addItemsDragAndDropListener(ComponentEventListener<ItemsDragAndDropEvent> listener) {
    addListener(ItemsDragAndDropEvent.class, listener);
  }
  
  /**
   * Sets whether tooltip should be displayed while updating an item.
   * 
   * @param tooltip true if tooltip is allowed
   */
  public void setTooltipOnItemUpdateTime(boolean tooltip) {
    getTimelineOptions().tooltipOnItemUpdateTime = tooltip;
    updateTimelineOptions();
  }
  
  /**
   * Sets the date format for the dates displayed in the 
   * on update item tooltip.
   * 
   * @param dateFormat format for tooltip dates
   */
  public void setTooltipOnItemUpdateTimeDateFormat(String dateFormat) {
    getTimelineOptions().tooltipOnItemUpdateTimeDateFormat = dateFormat;
    updateTimelineOptions();
  }
  
  /**
   * Sets the template for the tooltip displayed on item update.
   * <p>To reference item start and end dates, please use item.start 
   * and item.end to be able to parse the template in the
   * client-side. 
   * <p>
   * E.g.: Starting at item.start, ending at item.end.
   * 
   * @param template the template shown in the tooltip
   */
  public void setTooltipOnItemUpdateTimeTemplate(String template) {
    getTimelineOptions().tooltipOnItemUpdateTimeTemplate = template;
    updateTimelineOptions();
  }

}
