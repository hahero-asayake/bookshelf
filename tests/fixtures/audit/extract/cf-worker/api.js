export function reject() {
    return json({ error: 'ユーザー名が使えません' }, 400);
}
