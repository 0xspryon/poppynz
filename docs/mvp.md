We have 3 classes of users

## Service Providers

Sub divided into 2 classes (major dommo, classical helper, aka nanny)

- Submit profile for review (critical, police clearance, could be automated with Credible.com API, hourly rate)
- get notifications at each review step of their profile.
- set up profile and availability
- vouch for another service provider to join
- back and forth communication with family
- Enter into contractual agreement with family
- Rate a family

## Families

- browse service provider lists
- back and forth communication with service provider
- vouch for another family to join
- Sign contractual agreement with service provider
- Rate a service provider
- Sophisticated geo viscinity filtering of service providers(hard to get right, basically geofencing searches)

## Admin

- review service provider profile (approve or reject)
- Get notifications of new applications for approval.
- Blacklisting for both service providers/family
  (naive approach, easy to implement, sophisticated fingerprinting approach, difficult to implement)

## Misc functionalities

- Show availability calendar for each service provider(hard to get right)
- Capture payments at contract signing
- Standard service provider needs >= 100hrs of service provided before they can apply to become a major-dommo
- interface where a person being vouched for can see the progress of them being vouched for.

## Questions

The biggest risk to this business model is how do we prevent both parties from circumventing us.
We'll need to think deeply about this.1

## Implementation timeline

There are 2 functionalities for which I'm not yet certain how the implementation will look like.

- Sophisticated go viscinity filtering of service providers
- Show availability calendar of each service provider

What the MVP looks like for me is all the above except for:

- Sophisticated geo-fenced filtering
- Show availability calendar of each service provider
- Stripe integration.

I see the timeline as follows

### First 4 weeks

- Get above mvp implemented with the exceptions indicated
- Testing of mvp

### Next 2 weeks

- Test mvp end to end
- Switch to prod (go to prod without stripe integration, this will come in under 2 weeks)
- Integrate Stripe
- Implement geo-fenced searching of service providers
- Implement viewing of availability in calendar view
  There's a high probability one of these last 2 points would bleed past the 2 weeks mark.
