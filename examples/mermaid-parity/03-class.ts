// Port of Mermaid syntax doc: Class diagram (ref/classDiagram.md).
// Source: the doc's FIRST example — the "Animal example" block in the intro
// ("# Class diagrams") — quoted verbatim below (title frontmatter included).
// Reveal: topological (Animal before its three subclasses' edges).
// Beat: highlight a class box byId — Circumscribe around `Animal`.
//
// The loader now inlines mermaid's <style> CSS (class boxes, note fills) and
// extracts <text> labels (title, class names, member rows, note text).
// Remaining gap: <marker> arrowheads (inheritance triangles) are stripped.

import { Scene, Circumscribe, loadMermaid, revealDiagram } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SOURCE = `---
title: Animal example
---
classDiagram
    note "From Duck till Zebra"
    Animal <|-- Duck
    note for Duck "can fly\ncan swim\ncan dive\ncan help in debugging"
    Animal <|-- Fish
    Animal <|-- Zebra
    Animal : +int age
    Animal : +String gender
    Animal: +isMammal()
    Animal: +mate()
    class Duck{
        +String beakColor
        +swim()
        +quack()
    }
    class Fish{
        -int sizeInFeet
        -canEat()
    }
    class Zebra{
        +bool is_wild
        +run()
    }`;

class ClassPort extends Scene {
  async construct() {
    const d = await loadMermaid(SOURCE);
    d.moveTo([0, 0, 0]);
    this.add(d);

    await this.play(revealDiagram(d, { runTime: 4 }));
    await this.wait(0.3);

    // Beat: draw a highlight frame around the Animal class box.
    await this.play(new Circumscribe(d.byId("Animal"), { color: "#e5484d" }));
    await this.wait(1);
  }
}

await demoRender(ClassPort, import.meta.url);
