// Android writes the lock screen's and home screen's date short. The kit is given the long form (the
// phone's clock, "Friday, October 9"), so this shortens the day and month names it recognises.

const SHORT: Record<string, string> = {
  Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat", Sunday: "Sun",
  January: "Jan", February: "Feb", March: "Mar", April: "Apr", June: "Jun", July: "Jul", August: "Aug",
  September: "Sep", October: "Oct", November: "Nov", December: "Dec",
};

/** Android's short date: "Friday, October 9" becomes "Fri, Oct 9". Other words are left as they are. */
export function shortDate(date: string): string {
  return date.replace(/\b[A-Z][a-z]+\b/g, (word) => SHORT[word] ?? word);
}
