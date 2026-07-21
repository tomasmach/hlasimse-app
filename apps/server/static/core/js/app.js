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

  Array.prototype.forEach.call(document.querySelectorAll("form[data-confirm]"), function (form) {
    form.addEventListener("submit", function (event) {
      if (!window.confirm(form.getAttribute("data-confirm"))) event.preventDefault();
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-checkin-form]"), function (form) {
    var consent = form.querySelector("[data-checkin-location]");
    var latitude = form.querySelector("[data-checkin-latitude]");
    var longitude = form.querySelector("[data-checkin-longitude]");
    var accuracy = form.querySelector("[data-checkin-accuracy]");
    var status = form.querySelector("[data-checkin-location-status]");
    var submit = form.querySelector("[data-checkin-submit]");
    var resolved = false;

    form.addEventListener("submit", function (event) {
      if (resolved || !consent || !consent.checked) return;
      event.preventDefault();
      latitude.value = "";
      longitude.value = "";
      accuracy.value = "";
      status.textContent = "Zjišťuji polohu pouze pro toto ohlášení…";
      submit.disabled = true;

      var continueWithoutStoredState = function (message) {
        status.textContent = message;
        resolved = true;
        submit.disabled = false;
        form.requestSubmit(submit);
      };

      if (!navigator.geolocation) {
        continueWithoutStoredState("Prohlížeč polohu neposkytuje. Ohlášení pokračuje bez ní.");
        return;
      }

      navigator.geolocation.getCurrentPosition(
        function (position) {
          latitude.value = position.coords.latitude.toFixed(6);
          longitude.value = position.coords.longitude.toFixed(6);
          if (Number.isFinite(position.coords.accuracy)) {
            accuracy.value = Math.max(0, position.coords.accuracy).toFixed(2);
          }
          continueWithoutStoredState("Poloha je připravená. Odesílám ohlášení serveru…");
        },
        function () {
          continueWithoutStoredState("Poloha nebyla připojena. Ohlášení pokračuje bez ní.");
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    });
  });

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
