// middleware/langMiddleware.js
module.exports = (req, res, next) => {
    const langMatch = req.path.match(/^\/api\/(fr|en|ja)(\/|$)/);

    if (!langMatch) {
        const fallbackLang = 'en'; // Langue par défaut
        const pathWithoutApiPrefix = req.path.replace(/^\/api\/[^\/]+/, '');
        const newPath = `/api/${fallbackLang}${pathWithoutApiPrefix}`;
        return res.redirect(302, newPath);
    }

    req.lang = langMatch[1];
    next();
};
  