package com.vaadin.componentfactory.timeline;

import com.vaadin.componentfactory.timeline.model.Item;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.router.Route;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Mirrors the shape of the real-app page that triggered the pre-create
 * addItem race: stacked ungrouped timelines whose items are added one
 * addItem() call at a time while the timelines are still DETACHED (the view
 * is built first, attached at the end), plus a button that keeps adding items
 * after attach.
 *
 * <p>Before the batching fix each addItem sent its own executeJs, so a load
 * fired (rows x items) client calls that hit the not-yet-constructed timeline
 * and threw, and each surviving call triggered a full redraw. Now detached
 * adds are carried by the create call, and post-attach adds are flushed as a
 * single batched call per round trip.
 */
@Route(value = "add-items-race", layout = MainLayout.class)
public class AddItemsRaceExample extends Div {

  private static final LocalDateTime DAY = LocalDateTime.of(2021, 8, 11, 0, 0, 0);
  private static final int ROWS = 8;
  private static final int ITEMS_PER_ROW = 7;

  private final List<Timeline> timelines = new ArrayList<>();
  private int added = 0;

  public AddItemsRaceExample() {
    for (int row = 0; row < ROWS; row++) {
      Timeline timeline = new Timeline();
      timeline.setStack(true);
      timeline.setTimelineRange(DAY, DAY.plusDays(256));
      // race path: every item added while the timeline is still detached
      for (int i = 0; i < ITEMS_PER_ROW; i++) {
        timeline.addItem(rowItem(row, i));
      }
      timelines.add(timeline);
      Div rowDiv = new Div(new Span("Person " + row));
      rowDiv.getStyle().set("display", "flex").set("align-items", "center");
      rowDiv.add(timeline);
      add(rowDiv);
    }

    // batching path: adds after attach, all flushed as one call per round trip
    Button addAll =
        new Button(
            "Add one item to every row",
            e -> {
              added++;
              for (int row = 0; row < ROWS; row++) {
                timelines.get(row).addItem(buttonItem(row, added));
              }
            });
    add(new Div(addAll));
  }

  private static Item rowItem(int row, int index) {
    LocalDateTime start = DAY.plusDays(index * 30 + row).withHour(9);
    Item item = new Item(start, start.plusHours(8), "r" + row + " i" + index);
    item.setId("row" + row + "-item" + index);
    return item;
  }

  private static Item buttonItem(int row, int nth) {
    LocalDateTime start = DAY.plusDays(2 + row * 1).withHour(6);
    Item item = new Item(start, start.plusHours(4), "extra " + nth);
    item.setId("row" + row + "-extra" + nth);
    return item;
  }
}
