package com.vaadin.componentfactory.timeline;

import com.vaadin.componentfactory.timeline.model.Group;
import com.vaadin.componentfactory.timeline.model.Item;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.router.Route;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

@Route(value = "grouped", layout = MainLayout.class)
public class GroupedItemsExample extends Div {

  private static final LocalDateTime DAY = LocalDateTime.of(2021, 8, 11, 0, 0, 0);

  public GroupedItemsExample() {
    // create groups (order controls which row is on top)
    Group group1 = new Group("1", "Team A");
    group1.setOrder(1);

    Group group2 = new Group("2", "Team B");
    group2.setOrder(2);

    Group group3 = new Group("3", "Team C");
    group3.setOrder(3);

    List<Group> groups = Arrays.asList(group1, group2, group3);

    // Team A: three sequential items
    List<Item> items =
        Arrays.asList(
            item("a1", 2, 30, 5, 0, "A 1", "1"),
            item("a2", 5, 30, 8, 0, "A 2", "1"),
            item("a3", 8, 30, 11, 0, "A 3", "1"),
            // Team B: two overlapping items (stacked vertically in the row)
            // plus a later one
            item("b1", 3, 0, 6, 0, "B 1", "2"),
            item("b2", 4, 0, 7, 0, "B 2", "2"),
            item("b3", 10, 0, 13, 0, "B 3", "2"),
            // Team C: a single long item
            item("c1", 12, 0, 18, 0, "C 1", "3"),
            // ungrouped item: vis-timeline does not place items without a
            // group once any groups are set -> not rendered (native behavior)
            item("u1", 20, 0, 22, 0, "No group", null),
            // item referencing a group that does not exist -> also not
            // rendered, and must not break rendering of the other items
            item("d1", 15, 0, 16, 0, "Ghost group", "9"));

    // timeline creation with groups
    Timeline timeline = new Timeline(items, groups);
    timeline.setStack(true);

    // setting timeline range
    timeline.setTimelineRange(
        LocalDateTime.of(2021, 8, 10, 00, 00, 00), LocalDateTime.of(2021, 8, 15, 00, 00, 00));

    add(timeline);
  }

  private static Item item(
      String id, int h1, int m1, int h2, int m2, String content, String group) {
    Item item =
        new Item(
            DAY.withHour(h1).withMinute(m1), DAY.withHour(h2).withMinute(m2), content, group);
    item.setId(id);
    return item;
  }
}
