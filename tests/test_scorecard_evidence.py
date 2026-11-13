"""Regression checks for partial scorecards and candidate-provided evidence."""

import json

from src.agent import has_scoreable_answers, read_scorecard, unassessed_scorecard


def test_only_name_produces_no_scores_or_claimed_strengths() -> None:
    invented = json.dumps(
        {
            "ratings": {
                "technical_accuracy": {"score": 5, "evidence": "My name is Sahil"},
            },
            "strengths": [
                {"text": "Strong Flask proficiency", "evidence": "My name is Sahil"}
            ],
            "improvement": None,
        }
    )

    assert read_scorecard(invented, ["My name is Sahil."]) == unassessed_scorecard()
    assert not has_scoreable_answers(2, ["My name is Sahil."])
    assert not has_scoreable_answers(1, ["Hi.", "My name is Sahil."])


def test_malformed_model_output_produces_an_unassessed_card() -> None:
    assert (
        read_scorecard("not JSON", ["My name is Sahil.", "I used Flask."])
        == unassessed_scorecard()
    )


def test_resume_only_or_invented_evidence_is_not_scored() -> None:
    fabricated = json.dumps(
        {
            "ratings": {
                "technical_accuracy": {
                    "score": 4,
                    "evidence": "I built a Flask API project",
                },
            },
            "strengths": [
                {
                    "text": "Strong proficiency in Flask",
                    "evidence": "I built a Flask API project",
                }
            ],
            "improvement": None,
        }
    )

    result = read_scorecard(fabricated, ["My name is Sahil.", "I need to stop now."])

    assert result["ratings"]["technical_accuracy"] is None
    assert result["overall"] is None
    assert result["strengths"] == []


def test_evidenced_partial_rating_does_not_create_overall_score() -> None:
    evidence = "I used Flask to build a small API"
    response = json.dumps(
        {
            "ratings": {"technical_accuracy": {"score": 3, "evidence": evidence}},
            "strengths": [{"text": "Described an API project", "evidence": evidence}],
            "improvement": None,
        }
    )

    result = read_scorecard(response, ["My name is Sahil.", evidence + "."])

    assert result["ratings"]["technical_accuracy"] == 3
    assert result["ratings"]["problem_solving"] is None
    assert result["overall"] is None
    assert result["strengths"] == [evidence]
    assert result["improvement_evidence"] == evidence


def test_one_answer_cannot_produce_a_perfect_score() -> None:
    evidence = "I used Flask to build a small API"
    response = json.dumps(
        {"ratings": {"technical_accuracy": {"score": 5, "evidence": evidence}}}
    )

    result = read_scorecard(response, ["My name is Sahil.", evidence])

    assert result["ratings"]["technical_accuracy"] is None
    assert result["overall"] is None


def test_overall_is_calculated_only_when_every_area_has_evidence() -> None:
    answer = "I built an API, explained the design, and discussed trade offs"
    fields = (
        "technical_accuracy",
        "problem_solving",
        "communication",
        "role_relevance",
    )
    response = json.dumps(
        {
            "ratings": {
                field: {"score": score, "evidence": answer}
                for field, score in zip(fields, (3, 4, 3, 4), strict=True)
            },
            "strengths": [],
            "improvement": None,
        }
    )

    result = read_scorecard(response, ["My name is Sahil.", answer])

    assert result["overall"] == 3.5
