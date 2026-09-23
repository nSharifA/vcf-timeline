package com.vaadin.componentfactory.timeline.model;

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

import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

import java.util.Objects;
import java.util.Optional;

/**
 * Representation of a timeline group, backed by vis-timeline's native grouping.
 * Items are assigned to a group via {@link Item#setGroup(String)}. A timeline
 * without groups renders exactly as before.
 */
public class Group {

  private String id;

  private String content;

  private String className;

  private Integer order;

  private Boolean visible;

  public Group() {}

  public Group(String id, String content) {
    this.setId(id);
    this.setContent(content);
  }

  public String getId() {
    return id;
  }

  public void setId(String id) {
    this.id = id;
  }

  public String getContent() {
    return content;
  }

  public void setContent(String content) {
    this.content = content;
  }

  public String getClassName() {
    return className;
  }

  /** Optional CSS class applied to the group's row and label. */
  public void setClassName(String className) {
    this.className = className;
  }

  public Integer getOrder() {
    return order;
  }

  /** Group sorting key, lower values render higher up. Null means insertion order. */
  public void setOrder(Integer order) {
    this.order = order;
  }

  public Boolean getVisible() {
    return visible;
  }

  /** Whether the group row is shown. Null means visible (vis-timeline default). */
  public void setVisible(Boolean visible) {
    this.visible = visible;
  }

  @Override
  public int hashCode() {
    return Objects.hash(id);
  }

  @Override
  public boolean equals(Object obj) {
    if (this == obj) return true;
    if (obj == null) return false;
    if (getClass() != obj.getClass()) return false;
    Group other = (Group) obj;
    return Objects.equals(id, other.id);
  }

  public String toJSON() {
    ObjectNode js = JsonNodeFactory.instance.objectNode();
    Optional.ofNullable(getId()).ifPresent(v -> js.put("id", v));
    Optional.ofNullable(getContent()).ifPresent(v -> js.put("content", v));
    Optional.ofNullable(getClassName()).ifPresent(v -> js.put("className", v));
    Optional.ofNullable(getOrder()).ifPresent(v -> js.put("order", v));
    Optional.ofNullable(getVisible()).ifPresent(v -> js.put("visible", v));
    return js.toString();
  }
}
