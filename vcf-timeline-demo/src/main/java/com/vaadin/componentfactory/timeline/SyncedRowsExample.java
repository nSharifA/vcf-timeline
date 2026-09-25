package com.vaadin.componentfactory.timeline;

import com.vaadin.componentfactory.timeline.model.Group;
import com.vaadin.componentfactory.timeline.model.Item;
import com.vaadin.flow.component.dependency.CssImport;
import com.vaadin.flow.component.avatar.Avatar;
import com.vaadin.flow.component.avatar.AvatarVariant;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.checkbox.Checkbox;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.notification.Notification;
import com.vaadin.flow.component.orderedlayout.HorizontalLayout;
import com.vaadin.flow.router.Route;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * A left column of real Vaadin components (avatar, name, button) glued to the
 * rows of a grouped timeline. vis-timeline's own label panel is hidden by CSS
 * and every row keeps a marker class so that, after each redraw, a small
 * script measures the rows and positions the matching cell next to it. The
 * components are fully server-managed: their click listeners run on the
 * server like in any other Flow view.
 */
@Route(value = "synced-rows", layout = MainLayout.class)
@CssImport("./styles/synced-rows.css")
public class SyncedRowsExample extends Div {

  private static final LocalDateTime DAY = LocalDateTime.of(2021, 8, 11, 0, 0, 0);

  /** Prefix of the marker class linking a side cell to its timeline row. */
  private static final String ROW_CLASS = "sync-row-";

  /**
   * Positions every [data-group] cell of the column element ($0) at the row
   * of the timeline element ($1) carrying the same marker class. Re-runs via
   * a MutationObserver (vis (re)creates and restyles rows asynchronously)
   * throttled by requestAnimationFrame.
   */
  private static final String SYNC_JS = """
      const column = $0, root = $1;
      let queued = 0;
      function measure() {
        const base = root.getBoundingClientRect();
        column.querySelectorAll('[data-group]').forEach(function (cell) {
          // scope to the foreground: every group also has hidden background
          // and axis elements carrying the same classes
          const row = root.querySelector('.vis-foreground .vis-group.' + cell.dataset.group);
          if (!row) {
            cell.style.opacity = '0.25';
            return;
          }
          const r = row.getBoundingClientRect();
          cell.style.top = (r.top - base.top) + 'px';
          cell.style.height = r.height + 'px';
          cell.style.opacity = '';
        });
      }
      function schedule() {
        if (!queued) queued = requestAnimationFrame(function () { queued = 0; measure(); });
      }
      new MutationObserver(schedule).observe(root, {
        subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class']
      });
      window.addEventListener('resize', schedule);
      schedule();
      setTimeout(measure, 1000);
      """;

  public SyncedRowsExample() {
    addClassName("synced-rows-demo");

    // one group (= row) per employee; order controls the vertical order
    List<Group> groups = new ArrayList<>();
    groups.add(group("1", "Anna Newman", 1));
    groups.add(group("2", "Ben Carter", 2));
    groups.add(group("3", "Cara Silva", 3));
    groups.add(group("4", "Dan Petrov", 4));
    groups.add(group("5", "Elena Weiss", 5));

    List<Item> items =
        Arrays.asList(
            item("n1", "1", 8, 16, "Day shift"),
            item("c1", "2", 6, 14, "Morning"),
            item("c2", "2", 14, 22, "Evening"),
            item("s1", "3", 9, 12, "Task A"),
            item("s2", "3", 15, 18, "Task B"),
            item("p1", "4", 0, 8, "Night shift"),
            item("w1", "5", 20, 24, "On call"));

    Timeline timeline = new Timeline(items, groups);
    timeline.setStack(true);
    timeline.setGroupOrder("order");
    timeline.setTimelineRange(DAY, DAY.plusDays(1));

    // toggle the client-side connection arrows (arrow.js) at runtime
    Checkbox arrows = new Checkbox("Show arrows", true);
    arrows.addValueChangeListener(e -> timeline.setArrowsEnabled(e.getValue()));
    timeline.setArrowsEnabled(arrows.getValue());

    // the side column: one absolutely positioned cell per group,
    // moved onto its row by the sync script below
    Div column = new Div();
    column.setClassName("sync-column");
    for (Group group : groups) {
      column.add(cell(group));
    }

    Div timelineBox = new Div(timeline);
    timelineBox.getStyle().set("flex", "1").set("min-width", "0");

    HorizontalLayout layout = new HorizontalLayout(column, timelineBox);
    layout.setWidthFull();
    layout.setSpacing(false);
    layout.setPadding(false);
    add(arrows, layout);

    layout.getElement().executeJs(SYNC_JS, column.getElement(), timeline.getElement());
  }

  private static Group group(String id, String name, int order) {
    Group group = new Group(id, name);
    group.setOrder(order);
    // the marker class is applied by vis-timeline to the row element
    group.setClassName(ROW_CLASS + id);
    return group;
  }

  private static Item item(String id, String group, int h1, int h2, String content) {
    Item item = new Item(DAY.withHour(h1), end(h2), content, group);
    item.setId(id);
    return item;
  }

  private static LocalDateTime end(int hour) {
    return hour >= 24 ? DAY.plusDays(1) : DAY.withHour(hour);
  }

  private Div cell(Group group) {
    Div cell = new Div();
    cell.setClassName("sync-cell");
    cell.getElement().setAttribute("data-group", ROW_CLASS + group.getId());

    Avatar avatar = new Avatar(group.getContent());
    avatar.addThemeVariants(AvatarVariant.LUMO_SMALL);

    Span name = new Span(group.getContent());

    Button details =
        new Button(
            "Details",
            e ->
                Notification.show(
                    "Details clicked for " + group.getContent() + " (server-side event)",
                    2500,
                    Notification.Position.MIDDLE));
    details.addThemeVariants(ButtonVariant.LUMO_SMALL, ButtonVariant.LUMO_TERTIARY);

    cell.add(avatar, name, details);
    return cell;
  }
}
