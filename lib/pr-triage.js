class PRTriage {
  constructor(github, config = {}) {
    this.github = github;
    this.config = Object.assign({}, require("./defaults"), config || {});
    this.pullRequest = {};
  }

  static get STATE() {
    return Object.freeze({
      WIP: "labelWip",
      UNREVIED: "labelUnreviewed",
      APPROVED: "labelApproved",
      CHANGES_REQUESTED: "labelChangesRequested"
    });
  }

  // see https://developer.github.com/v3/pulls/reviews/#submit-a-pull-request-review
  // see https://developer.github.com/v3/pulls/reviews/#create-a-pull-request-review
  static get GH_REVIEW_STATE() {
    return Object.freeze({
      APPROVE: "APPROVE",
      CHANGES_REQUESTED: "CHANGES_REQUESTED",
      COMMENT: "COMMENT"
    });
  }

  async triage() {
    this.pullRequest = (await this.github.issues.get(this.config)).data;
    await this._ensurePRTriageLabelExists();

    const state = await this._getState();
    switch (state) {
      case PRTriage.STATE.WIP:
        this._updateLabel(PRTriage.STATE.WIP);
        break;
      case PRTriage.STATE.UNREVIED:
        this._updateLabel(PRTriage.STATE.UNREVIED);
        break;
      case PRTriage.STATE.CHANGES_REQUESTED:
        this._updateLabel(PRTriage.STATE.CHANGES_REQUESTED);
        break;
      case PRTriage.STATE.APPROVED:
        this._updateLabel(PRTriage.STATE.APPROVED);
        break;
      default:
        throw new Error("Undefined state");
    }
  }

  async _getState() {
    if (this.pullRequest.title.match(this._getConfigObj("wipRegex"))) {
      return PRTriage.STATE.WIP;
    }

    const reviews = await this._getUniqueReviews();
    if (reviews.length === 0) {
      return PRTriage.STATE.UNREVIED;
    } else {
      const ChangeRequestedReviews = reviews.filter(
        review => review.state === PRTriage.GH_REVIEW_STATE.CHANGES_REQUESTED
      );
      const approvedReviews = reviews.filter(
        review => review.state === PRTriage.GH_REVIEW_STATE.APPROVE
      );

      if (ChangeRequestedReviews.length > 0) {
        return PRTriage.STATE.CHANGES_REQUESTED;
      } else if (reviews.lnegth === approvedReviews.length) {
        return PRTriage.STATE.APPROVED;
      }
    }
  }

  async _getUniqueReviews() {
    const reviews =
      (await this.github.pullRequests.getReviews(this.config)).data || [];
    const uniqueReviews = reviews
      .filter(review => review.commit_id === this._getConfigObj("sha"))
      .filter(review => review.state !== PRTriage.GH_REVIEW_STATE.COMMENT)
      .reduce((reviewObj, review) => {
        if (
          reviewObj[review.user.id] === null ||
          reviewObj[review.user.id] === undefined
        ) {
          reviewObj[review.user.id] = {
            state: review.state,
            submitted_at: review.submitted_at
          };
        } else {
          const a = new Date(
            reviewObj[review.user.id]["submitted_at"]
          ).getTime();
          const b = new Date(review.submitted_at).getTime();
          if (a < b) {
            reviewObj[review.user.id] = {
              state: review.state,
              submitted_at: review.submitted_at
            };
          }
        }
        return reviewObj;
      }, {});

    return Object.values(uniqueReviews);
  }

  async _ensurePRTriageLabelExists() {
    for (const labelObj in this._getFilteredConfigObjByRegex(/label_*/)) {
      await this._createLabel(labelObj);
    }
  }

  async _createLabel(key) {
    const { owner, repo } = this.config;
    const labelObj = this._getConfigObj(key);

    return this.github.issues
      .getLabel({ owner, repo, name: labelObj.name })
      .catch(() => {
        return this.github.issues.createLabel({
          owner,
          repo,
          name: labelObj.name,
          color: labelObj.color
        });
      });
  }

  async _addLabel(key) {
    const { owner, repo, number } = this.config;
    const labelObj = this._getConfigObj(key);

    // Check if a label does not exist. If it does, it addes the label.
    return this._getLabel(key).catch(() => {
      return this.github.issues.addLabels({
        owner,
        repo,
        number,
        labels: [labelObj.name]
      });
    });
  }

  async _removeLabel(key) {
    const { owner, repo, number } = this.config;
    const labelObj = this._getConfigObj(key);

    // Check if a label exists. If it does, it removes the label.
    return this._getLabel(key).then(
      labelObj => {
        return this.github.issues
          .removeLabel({ owner, repo, number, name: labelObj.name })
          .catch(err => {
            // Ignore if it's a 404 because then the label was already removed
            if (err.code !== 404) {
              throw err;
            }
          });
      },
      () => {}
    ); // Do nothing for error handling.
  }

  async _updateLabel(labelKey) {
    const currentLabelKey = await this._getCurrentLabelKey();
    if (currentLabelKey) {
      if (labelKey === PRTriage.STATE.WIP) {
        this._removeLabel(currentLabelKey);
      } else if (currentLabelKey !== labelKey) {
        this._removeLabel(currentLabelKey);
        this._addLabel(labelKey);
      }
    } else {
      this._addLabel(labelKey);
    }
  }

  _getLabel(key) {
    return new Promise((resolve, reject) => {
      for (const label of this.pullRequest.labels) {
        const lableObj = this._getConfigObj(key);
        if (lableObj && lableObj.name && label.name === lableObj.name) {
          resolve(lableObj);
        }
      }
      reject(new Error("Not found"));
    });
  }

  _getCurrentLabelKey() {
    return this.pullRequest.labels
      .map(label => {
        const filteredConfig = this._getFilteredConfigObjByRegex(/label_*/);
        for (const labelKey in filteredConfig) {
          const configValue = filteredConfig[labelKey];
          if (
            configValue &&
            configValue.name &&
            label.name === configValue.name
          ) {
            return labelKey;
          }
        }
      })
      .filter(key => key !== "undefined")[0];
  }

  _getFilteredConfigObjByRegex(regex) {
    return Object.keys(this.config).reduce((result, key) => {
      if (regex.test(key)) {
        result[key] = this._getConfigObj(key);
      }
      return result;
    }, {});
  }

  _getConfigObj(key) {
    return this.config[key];
  }
}

module.exports = PRTriage;