package com.vaadin.componentfactory.timeline;

import com.vaadin.componentfactory.timeline.model.Item;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.dependency.JsModule;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.orderedlayout.HorizontalLayout;
import com.vaadin.flow.router.Route;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

@Route(value = "locale", layout = MainLayout.class)
@JsModule("./moment-hu.js")
public class LocaleExample extends Div {

  public LocaleExample() {
    // items around the current date so the current time indicator
    // (localized via the "current"/"time" strings) stays visible
    LocalDate today = LocalDate.now();
    Item item1 =
        new Item(today.minusDays(3).atTime(9, 0), today.minusDays(3).atTime(12, 0), "Item 1");
    item1.setId("1");
    Item item2 = new Item(today.minusDays(1).atTime(13, 0), today.atTime(5, 0), "Item 2");
    item2.setId("2");
    Item item3 = new Item(today.atTime(8, 30), today.atTime(9, 30), "Item 3");
    item3.setId("3");
    Item item4 =
        new Item(today.plusDays(2).atTime(10, 0), today.plusDays(2).atTime(16, 0), "Item 4");
    item4.setId("4");

    List<Item> items = Arrays.asList(item1, item2, item3, item4);
    items.forEach(
        i -> {
          i.setEditable(true);
          i.setUpdateTime(true);
        });

    Timeline timeline = new Timeline(items);
    timeline.setShowCurentTime(true);
    timeline.setTimelineRange(today.minusDays(4).atStartOfDay(), today.plusDays(4).atStartOfDay());

    // Hungarian by default: axis month/day names come from the moment.js
    // locale data imported in moment-hu.js; these three strings are the only
    // ones passed explicitly, vis-timeline has no built-in Hungarian table.
    timeline.setLocale(Locale.forLanguageTag("hu"));
    timeline.setLocaleStrings("aktuális", "idő", "Kijelölés törlése");

    HorizontalLayout localeLayout = new HorizontalLayout();
    localeLayout.setMargin(true);
    Button english = new Button("English", e -> timeline.setLocale((String) null));
    Button german = new Button("Deutsch", e -> timeline.setLocale(Locale.GERMAN));
    Button hungarian =
        new Button(
            "Magyar",
            e -> {
              timeline.setLocale(Locale.forLanguageTag("hu"));
              timeline.setLocaleStrings("aktuális", "idő", "Kijelölés törlése");
            });
    localeLayout.add(english, german, hungarian);

    add(localeLayout, timeline);
  }
}
