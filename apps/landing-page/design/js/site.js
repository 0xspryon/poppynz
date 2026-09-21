// Poppynz landing site — small progressive enhancements.
(function () {
  // Autoplay muted hero videos (some browsers need an explicit play()).
  function playVideos() {
    document.querySelectorAll('video').forEach(function (v) {
      v.muted = true; v.loop = true; v.playsInline = true;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
    });
  }
  playVideos();
  setTimeout(playVideos, 800);

  // FAQ accordions: one item open at a time, first open by default.
  document.querySelectorAll('.faq-list').forEach(function (list) {
    var items = Array.prototype.slice.call(list.querySelectorAll('.faq'));
    function setOpen(target) {
      items.forEach(function (item) {
        var open = item === target;
        item.classList.toggle('open', open);
        var btn = item.querySelector('button');
        var icon = btn.querySelector('i');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        icon.className = open ? 'las la-minus' : 'las la-plus';
      });
    }
    items.forEach(function (item) {
      item.querySelector('button').addEventListener('click', function () {
        setOpen(item.classList.contains('open') ? null : item);
      });
    });
  });
})();
