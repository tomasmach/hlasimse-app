(function () {
  "use strict";

  document.documentElement.classList.add("js");

  function bindDisclosure(button, panel, openClass) {
    if (!button || !panel) return;
    var close = function () {
      button.setAttribute("aria-expanded", "false");
      panel.classList.remove(openClass);
    };
    button.addEventListener("click", function () {
      var willOpen = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(willOpen));
      panel.classList.toggle(openClass, willOpen);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        close();
        button.focus();
      }
    });
  }

  bindDisclosure(
    document.querySelector("[data-nav-toggle]"),
    document.querySelector("[data-site-nav]"),
    "is-open"
  );
  bindDisclosure(
    document.querySelector("[data-dashboard-toggle]"),
    document.querySelector("[data-dashboard-sidebar]"),
    "is-open"
  );

  var carousel = document.querySelector("[data-carousel]");
  if (carousel) {
    var slides = Array.prototype.slice.call(carousel.querySelectorAll("[data-slide]"));
    var currentLabel = carousel.querySelector("[data-carousel-current]");
    var current = 0;
    var showSlide = function (next) {
      current = (next + slides.length) % slides.length;
      slides.forEach(function (slide, index) {
        var active = index === current;
        slide.hidden = !active;
        slide.classList.toggle("is-active", active);
      });
      if (currentLabel) currentLabel.textContent = String(current + 1);
    };
    var previous = carousel.querySelector("[data-carousel-prev]");
    var next = carousel.querySelector("[data-carousel-next]");
    if (previous) previous.addEventListener("click", function () { showSlide(current - 1); });
    if (next) next.addEventListener("click", function () { showSlide(current + 1); });
    showSlide(0);
  }
})();
